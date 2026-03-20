

# Priorität in Raum-Übersicht anzeigen

## Änderung

**Datei:** `src/components/heating/RoomStatusTable.tsx`

### Desktop-Tabelle
- Neue Spalte "Prio" nach "Raum" einfügen (Zeile 82)
- In jeder Zeile `room.priority` anzeigen (nach Zeile 94)

### Mobile-Ansicht
- Priorität in der Info-Zeile (Zeile 54) als "Prio: X" ergänzen

Die Tabelle wird nach Priorität sortiert (`tuyaRooms` nach `priority` ascending sortieren), damit die Reihenfolge der sequenziellen Heizung direkt sichtbar ist.

