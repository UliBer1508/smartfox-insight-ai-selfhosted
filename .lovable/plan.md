

## Plan: Target-Temp für Zimmer Luis und Luca auf 19°C setzen

### Aktion
Direktes Daten-Update in der `rooms`-Tabelle: `target_temp = 19` für die beiden Räume "Zimmer Luis" und "Zimmer Luca".

### Technische Details
- SQL `UPDATE` via Insert-Tool auf `rooms` Tabelle
- Filter: `name IN ('Zimmer Luis', 'Zimmer Luca')`
- Setzt `target_temp = 19` (entspricht der neuen `eco_temp`)
- Die Thermostate übernehmen den Wert beim nächsten pv-automation Heartbeat (alle 2 Min)

