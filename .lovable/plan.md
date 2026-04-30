## Aktueller Zustand (verifiziert)

Vienna-Zeit: **08:56** (also nach `night_end_time` 08:00 → es ist Tag-Modus).

**Haustür** (Prio 10)
- `automation_enabled = false` ✅ (bereits aus)
- `target_temp = 19` (Eco), `current_temp = 20.9`
- Heizt laut UI mit 400W → physisches Thermostat hat noch alten Sollwert, kann wegen Tuya-Quota (60001001) nicht synchronisiert werden
- `heating_paused_reason` enthält Hinweis „bitte am Thermostat manuell auf 19°C stellen"

**Wirtschaftsraum** (Prio 9)
- `target_temp = 18` (Nacht-Wert!), `current_temp = 19`, `eco_temp = 19`
- `automation_enabled = true`, `pv_auto_enabled = true`
- `heating_paused_reason = "budget"` → Automation hat ihn auf Nacht/aus gesetzt wegen fehlendem Budget
- Letzte Auto-Änderung: 06:02 (vor `night_end_time`!) — der Wirtschaftsraum wurde noch im Nachtmodus auf 18° gesetzt und seitdem nicht hochgezogen

→ Der Wirtschaftsraum hängt fest, weil die Automation seit 08:00 keinen Eco-Upgrade-Lauf für ihn gemacht hat (oder das Budget reicht nicht und er bleibt bei Nacht-Sollwert).

---

## Was zu tun ist

### 1. Haustür — Modus „Manuell" sauber kennzeichnen

Da das Thermostat physisch wegen Tuya-Quota nicht erreichbar ist, soll Haustür klar als „Manuell gesteuert" markiert sein:

- `automation_enabled = false` (ist schon)
- `pv_auto_enabled = false` (ist schon)
- `manual_override_until = NOW() + INTERVAL '30 days'` — markiert Raum dauerhaft als manuell, blockt jede Automation
- `heating_paused_reason = 'Manuell gesteuert (Tuya-Quota nicht steuerbar)'` — klarere Meldung
- UI-Anzeige in `ThermostatCard` prüfen: bei aktivem `manual_override_until` soll ein deutliches **„Manuell"**-Badge erscheinen statt „Eco" + roter Heiz-Indikator

### 2. Wirtschaftsraum — auf Eco hochziehen

Direkter Fix per DB-Update:
- `target_temp = 19` (Eco)
- `heating_paused_reason = NULL`
- `last_auto_change = NOW()` (verhindert sofortiges Zurücksetzen)

Damit greift die Standard-Automation beim nächsten Heartbeat-Lauf wieder normal.

### 3. Root-Cause-Check Wirtschaftsraum

Nachsehen warum Auto-Logik ihn auf 18° (Nacht) belässt obwohl nach 08:00. Vermutlich:
- Stage 4 (Precision) korrigiert den Sollwert nicht, weil `is_heating=false` und `current_temp ≥ target` → Logik denkt „passt"
- Oder Eco-Phase überspringt den Raum wegen `heating_paused_reason='budget'` ohne den Sollwert zurückzusetzen

→ In `pv-heating-optimizer` (Eco-Phase) prüfen: wenn ein Raum `target_temp < eco_temp` hat und Tag-Modus aktiv ist, muss er **immer** auf mindestens `eco_temp` hochgezogen werden, auch ohne Heiz-Aktion. Andernfalls bleibt der Sollwert auf Nacht-18° hängen sobald die Automation einmal Budget-blocked war.

### 4. Memory-Update

Eintrag in `mem://features/heating/eco-target-restoration` neu anlegen:
> Sobald Tag-Modus (nach `night_end_time`) aktiv ist, MUSS jeder automatisierte Raum mit `target_temp < eco_temp` auf `eco_temp` hochgezogen werden — unabhängig von Budget oder Heiz-Status. Sonst bleiben Räume auf Nacht-Sollwert (18°) wenn sie zur Nacht ins Budget-Lockout liefen.

---

## Technische Schritte

1. **Daten-Update** (Insert-Tool):
   ```sql
   UPDATE rooms SET 
     manual_override_until = NOW() + INTERVAL '30 days',
     heating_paused_reason = 'Manuell gesteuert (Tuya nicht erreichbar)'
   WHERE name = 'Haustür';
   
   UPDATE rooms SET 
     target_temp = 19,
     heating_paused_reason = NULL,
     last_auto_change = NOW()
   WHERE name = 'Wirtschaftsraum';
   ```

2. **Code-Änderungen**:
   - `supabase/functions/pv-heating-optimizer/index.ts` (oder entsprechendes Modul): Eco-Phase ergänzen — Räume mit `target_temp < eco_temp` im Tag-Modus immer hochziehen, auch ohne Heizfreigabe
   - `src/components/heating/ThermostatCard.tsx`: bei `manual_override_until > NOW()` ein **„Manuell"**-Badge (gelb/orange) anzeigen statt Auto-Häkchen
   - Falls vorhanden, das gleiche im Tabellen-View (`HeatingOverviewTable` o.ä.) ergänzen

3. **Verifikation**: nach 2-Min-Heartbeat Wirtschaftsraum prüfen → `target_temp` muss 19 bleiben, `heating_paused_reason` darf nicht wieder „budget" werden ohne dass der Sollwert auf 19 stehen bleibt.
