## Ziel
Drei Korrekturen umsetzen, basierend auf der vorhergehenden Analyse:
1. **Haustür sauber stilllegen** (Tuya 60001001 — nicht steuerbar)
2. **Flur** auf Standard-Konfiguration (eco=19 °C, comfort=21 °C)
3. **UI-Hinweis** „Konstanttemperatur" für Räume mit `eco_temp == comfort_temp`

## Änderungen im Detail

### A) Haustür DB-Reset
Update der Spalte in `rooms` für `name = 'Haustür'`:
- `target_temp = 19` (eco)
- `is_heating = false`
- `heating_paused_reason = 'Tuya Cloud-Subscription: Gerät nicht steuerbar (60001001) - bitte am Thermostat manuell auf 19°C stellen'`

Dazu ein einmaliger Cloud-Versuch via `tuya-control/set-temp` für die Haustür (best-effort — falls die Subscription doch reagiert, super; sonst muss am Thermostat manuell auf 19 °C gestellt werden, was der `heating_paused_reason`-Hinweis kommuniziert).

Umsetzung: kurze, einmalige Edge Function `oneshot-haustuer-flur-fix` (Service Role) → deployen → einmal aufrufen → Edge Function wieder löschen.

### B) Flur-Standardisierung
Update `rooms` für `name = 'Flur'`:
- `eco_temp = 19` (statt 20)
- `comfort_temp = 21` (statt 20)

Der Raum kann dann im normalen Phasen-System mitlaufen (Eco-Stufe 19 °C, Komfort-Stufe 21 °C wie alle anderen Räume).

Im selben one-shot Edge Function Call mit ausgeführt.

### C) UI-Hinweis „Konstanttemperatur"
In `src/components/heating/ThermostatCard.tsx`:
- Wenn `room.eco_temp === room.comfort_temp`, ein dezentes Badge/Tooltip neben den Preset-Buttons (Komfort/Eco/Nacht) anzeigen: „Konstant — Eco = Komfort", damit klar ist, dass kein Stufenwechsel stattfindet.
- Optionaler kleiner Tooltip-Text: „Eco- und Komforttemperatur sind identisch konfiguriert. Der Raum wird konstant auf dieser Temperatur gehalten."

Keine Logikänderung — rein visuell.

## Technische Details
- **One-shot Edge Function** `oneshot-haustuer-flur-fix`: nutzt Service Role Key, umgeht den `protect_rooms_sensitive_columns`-Trigger (der service_role erlaubt). Macht beide DB-Updates und einen best-effort Tuya-Cloud-Call. Wird nach erfolgreichem Lauf wieder gelöscht (`delete_edge_functions`).
- **UI-Komponente**: Neuer kleiner JSX-Block in `ThermostatCard.tsx` oberhalb oder unterhalb der 3 Preset-Buttons, conditional gerendert.

## Reihenfolge
1. Edge Function `oneshot-haustuer-flur-fix` schreiben + deployen
2. Function einmal per `curl_edge_functions` aufrufen, Ergebnis verifizieren
3. DB-Verifikation per `read_query`
4. Edge Function löschen
5. UI-Änderung in `ThermostatCard.tsx`
