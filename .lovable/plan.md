# Plan: Implementierung der ML-Entscheidungs-Persistierung

## Status: ✅ IMPLEMENTIERT (2026-02-06)

### Was wurde gemacht:
1. **pv-automation/index.ts** - Nach dem `analyze-patterns` Call (Zeile ~540) wird jetzt für jede ML-Entscheidung ein UPSERT in `room_recommendations` durchgeführt
2. **Unique Constraint** - `room_recommendations_room_date_period_unique` auf `(room_id, date, period_number)` erstellt
3. **Zeitzonen-Handling** - Wien-Zeit (`Europe/Vienna`) wird korrekt verwendet für Datum und Periode
4. **Priority Mapping** - ML actions (`activate/deactivate/keep`) werden zu Frontend-kompatiblen priorities (`heat_now/reduce/hold`) gemapped

### Verifikation:
Nach dem nächsten pv-automation Lauf sollte:
- `SELECT * FROM room_recommendations WHERE date = CURRENT_DATE;` Einträge haben
- Die UI unter "Aktuelle Thermostat-Empfehlungen" die ML-Entscheidungen anzeigen
- Logs zeigen: `✅ X ML-Entscheidungen in room_recommendations gespeichert`

