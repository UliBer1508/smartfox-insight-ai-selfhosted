## Problem

Nachts (20:00–08:00) feuert `pv-automation` weiterhin Tuya-Cloud-Calls — sichtbar an hunderten `night_frost_failed` Errors (alle 2 Min, ganze Nacht durch). Das frisst die knappe Tagesquota (heute schon 178 Calls verbraucht, **alle nachts**) und verhindert dadurch den Eco-Start am Morgen.

## Ursache (in `supabase/functions/pv-automation/index.ts` ab Zeile 680)

Im `frost_only`-Modus läuft alle 2 Minuten ein Block, der für JEDEN Raum Tuya-Cloud-Calls auslöst — und zwar in zwei Fällen:

1. **„Resync"** – alle 30 Min ein Pflicht-Re-Push auf 5 °C, *auch wenn der Thermostat schon auf Frostschutz steht*.
2. **„Neu"** – wenn `target_temp > 6 °C`.

Außerdem wird beim Fehlschlag (Quota erschöpft) ein **sofortiger Retry-Versuch** als Fallback unternommen → noch mehr Calls. Resultat: jede 2-Min-Iteration verbrennt 1× Call pro Raum × 12 Räume × Resyncs.

Das widerspricht deiner Vorgabe:
> Ab 20:00 Nacht → bis 08:00 nichts mehr machen → erst um 08:00 auf Eco.

## Lösung — Nacht-Stille-Modus

### Änderung 1: Einmaliger Frostschutz-Push beim Übergang in die Nacht

In `pv-automation` (Block ab Zeile 657) den Nacht-Pfad so umbauen, dass:

- **Nur EINMAL pro Nacht** (beim ersten Lauf nach `night_start_time`) Räume auf Frostschutz gesetzt werden — und auch nur jene, deren `target_temp > FROST_TEMP + 1`.
- **Kein periodischer 30-Min-Resync** mehr im `frost_only`-Modus. Begründung: TGP508 halten den Sollwert; falls ein internes Zeitprogramm dazwischenfunkt, wird das morgens beim Eco-Start ohnehin korrigiert. Der Nacht-Resync ist Quota-Verschwendung.
- **Tracking via `system_settings`-Key** `night_frost_last_pushed` (ISO-Datum), damit pro Nacht nur ein Push passiert. Reset beim ersten Tag-Lauf nach 08:00.
- **Bei Quota-/Steuerkanal-Fehler:** Eintrag in `api_errors` nur **einmal pro Nacht** (nicht alle 2 Min) — über denselben Settings-Key gesteuert.

### Änderung 2: Frühe Return-Bedingung verschärfen

Wenn `isNight === true` UND `night_frost_last_pushed === heutiges Nacht-Datum`:
→ Sofortiger Return mit Log `Night quiet mode (kein Tuya-Call)`. Keine Raum-Iteration, kein Tuya-Aufruf.

### Änderung 3: Morgen-Quota-Reset bei Tageswechsel

Beim ersten Lauf um 08:00 (Wien) `system_settings.tuya_api_quota.calls_today` weiterhin durch die `today`-Datumslogik zurücksetzen — UND `night_frost_last_pushed` löschen, damit der nächste Abend wieder einen sauberen Push machen kann.

### Änderung 4 (optional, gleich mit umsetzen): Quota-Anzeige im UI

Das `tuya_api_quota` ist im `SettingsPanel`/`TuyaSubscriptionAlert` aktuell nicht direkt sichtbar. Ein kleiner Counter „API-Calls heute: X / Y" wäre hilfreich, ist aber nicht zwingend für diesen Fix.

→ Diese Änderung **nicht** mit aufnehmen, separates Anliegen.

## Aufräumen jetzt (in derselben Umsetzung)

- Alle offenen `api_errors` mit `error_type IN ('night_frost_failed','no_control_channel','tuya_api')` aus heute Nacht als `resolved_at = NOW()` markieren — Banner verschwindet.
- `system_settings.tuya_api_quota.calls_today` auf 0 setzen (Monatscounter bleibt — der ist serverseitig bei Tuya gesperrt bis 1. Mai).

## Effekt

- **Vorher:** ~360 Cloud-Calls pro Nacht (12 Räume × 30 Iterationen) → Tagesquota schon morgens leer.
- **Nachher:** Genau 12 Calls beim Übergang um 20:00 + 0 Calls bis 08:00. Quota bleibt für den Tagbetrieb verfügbar.
- Eco-Umschaltung um 08:00 läuft, sobald Cloud verfügbar (sprich: nach Monats-Reset am 1. Mai oder nach Wechsel auf Local-Mode).

## Betroffene Dateien

- `supabase/functions/pv-automation/index.ts` — Nacht-Block (Zeile 652–830) umstrukturieren
- Migration: keine neue Tabelle nötig (`system_settings` reicht)
- DB-Cleanup-Query (einmalig über die SQL-Tools)

## Was NICHT geändert wird

- Tag-Logik, Eco/Komfort-Budget, Phase-1/2-Strategie — unberührt
- `night_heating_mode = 'maintain'`-Pfad — bleibt wie er ist (heizt aktiv weiter, andere Strategie)
- Local-Mode / Control-Mode-Switch — bleibt manuell
