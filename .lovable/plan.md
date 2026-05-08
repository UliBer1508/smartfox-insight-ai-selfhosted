## Diagnose

Bei 3,3 kW Überschuss (PV 10,4 kW, SOC 100 %, Verbrauch 6,8 kW) zeigt die DB:
- `pv-automation` (cron `*/2 min`) entscheidet korrekt: Phase 2 Komfort 22 °C für die Räume mit Priorität 1–5 (Bad Uli, Zimmer Uli/Luis/Luca, Kinder Bad). Logs zeigen `PV-HEIZEN - ☀️ Phase 2: Komfort 22°C ... Budget OK`.
- Trotzdem `is_heating=false` in allen Räumen, `consumption ≈ 6,8 kW` zeigt aber, dass die Estriche faktisch laufen — die Status-Erkennung ist sekundär. Das Hauptproblem ist:

### Root Cause: Zwei konkurrierende Steuerschleifen

`thermostat_commands` der letzten 30 Min zeigt ein **Setpoint-Flapping** im Minutentakt:

```
09:46:04  set_temp 22  ← pv-automation (Komfort)
09:53:32  set_temp 19/18/17 ← ALLE Räume auf night_temp ❗
09:54:03  set_temp 22  ← pv-automation korrigiert zurück
09:56:02  set_temp 22  ← pv-automation
...
```

Die Quelle der „19/18/17"-Welle: **`apply-recommendations`** (cron `apply-heating-recommendations */15 * * * *`).

Sie liest `room_recommendations`. Dort steht für heute, generiert um **07:00 vor Sonnenaufgang**, gültig **09:00–12:00**:
- Bad Uli/Zimmer*/Wohnzimmer → 19 °C
- Wirtschaftsraum/Flur/Waschraum → 18 °C
- Toilette → 17 °C
- Büro → 19 °C

Begründung in der DB: „Aktuelle Raumtemperatur liegt über der Nacht-Solltemperatur, und es ist kein PV-Überschuss zum Heizen verfügbar."

Das ist die **alte AI-Tagesplanung von vor Sonnenaufgang**, die `pv-automation v2` (Budget-Logik, Komfort-Sättigung, ML-Policies, Phase 1/2, Pre-Heat-Signal) komplett überflüssig macht und ihr aktiv widerspricht. `apply-recommendations` hat keine Budget-Awareness und keinen Komfort/Phase-Begriff — sie schreibt blind, was die KI um 07:00 für „kein PV erwartet" eingeplant hat.

Folge: Thermostat sieht Target 22 → 19 → 22 → 19 im 1–2-Minuten-Takt. Hardware-Hysterese (+0,3 °C off / -0,2 °C on) wird nie stabil unterschritten → kein sauberes Heizen, `is_heating` flackert/bleibt false.

### Warum das jetzt erst kracht

`pv-automation v2` (Komfort-Sättigung, Eco-Restoration, Battery-Full-Bonus, ML-Konsum) ist die **alleinige Wahrheitsquelle**. `apply-recommendations` stammt aus der v1-Architektur, in der die KI noch direkt Tagesfahrpläne durchstellte. Memory-Eintrag dazu fehlt — daher ist der Konflikt nicht dokumentiert und seit Wochen latent.

## Lösung (keine neue Logik, nur Konflikt entfernen)

**Strategie:** `apply-recommendations` aus dem automatischen Pfad nehmen. `pv-automation` konsumiert KI-Empfehlungen ohnehin ML-seitig (`learned_policies` + `preheating_signal`, vgl. `mem://arch/ai-system-limitations`). Eine zweite Steuerschicht ist redundant.

### Änderungen

1. **pg_cron Job `apply-heating-recommendations` deaktivieren / entfernen** (Migration: `cron.unschedule('apply-heating-recommendations')`). `pv-automation-check */2 min` bleibt einzige Setpoint-Quelle.

2. **Safety-Net in `apply-recommendations/index.ts`**: Falls die Funktion manuell (UI-Button) oder versehentlich getriggert wird, pro Raum überspringen wenn:
   - `pv_auto_active === true`, ODER
   - `last_auto_change` jünger als 10 Min, ODER
   - aktive `pv-automation`-Heartbeat-Marker in `system_settings.parallel_heating_capacity.computed_at` < 5 Min.
   
   Begründung-Skip wird in `results.skipped` mit `reason: 'pv-automation aktiv – kein Override'` geloggt. Verhindert dauerhaft, dass parallele Trigger Setpoint-Flapping erzeugen.

3. **Stale `room_recommendations` von heute neutralisieren**: Insert-Statement, das alle Empfehlungen für `date = CURRENT_DATE` mit `start_time ≥ '08:00'` löscht (Datenbereinigung, nicht-strukturell). Danach ist die DB konsistent mit der neuen Architektur. (Tabelle bleibt erhalten — `analyze-patterns` darf weiter Empfehlungen für die Zukunft schreiben; sie werden nur nicht mehr automatisch ausgeführt.)

4. **Memory-Update**: Neuer Eintrag `mem://arch/recommendations-not-auto-applied` und Vermerk im Core-Block, dass `apply-recommendations` kein Cron-Pfad mehr ist und `pv-automation` die einzige Setpoint-Autorität ist.

### Was bewusst NICHT geändert wird

- `analyze-patterns` (KI-Tagesplanung) bleibt unverändert — Empfehlungen sind weiter sichtbar in der UI als Beratung.
- `pv-automation`-Logik bleibt 1:1 (Budget, Phase 1/2, Komfort-Sättigung, ML-Policies). Kein neuer Code in der Heizungssteuerung.
- Lokaler Collector / Tuya-Cloud-Pfad / Hysterese: unverändert.
- `is_heating`-Erkennung: unverändert. Wenn das Flapping weg ist, läuft die normale 3-stufige Kaskade (`mem://arch/active-heating-status-source`) wieder sauber.

### Erwartetes Ergebnis nach Deploy

Innerhalb von 2–4 Minuten:
- Keine `set_temp 19/18/17`-Welle mehr alle 15 Min.
- Targets der prio-1–5-Räume bleiben stabil bei 22 °C.
- `is_heating` wird true sobald lokaler Collector den nächsten Datenpunkt liefert.
- 3,3 kW Überschuss + Batterie-Full-Bonus werden über die normale Komfort-Phase verbraucht.

## Technische Details (für Reviewer)

| Komponente | Aktion |
|---|---|
| `cron.job` | `unschedule('apply-heating-recommendations')` via Migration |
| `supabase/functions/apply-recommendations/index.ts` | Safety-Skip-Block in Schleife `for (const room of rooms)` direkt nach Manual-Override-Check |
| `room_recommendations` | DELETE WHERE date = CURRENT_DATE AND start_time >= '08:00' |
| `mem://index.md` + neuer Memory-Eintrag | Architektur-Regel dokumentieren |

Keine RLS-, Schema- oder Edge-Function-Verträge ändern sich.