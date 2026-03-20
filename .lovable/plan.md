

# Räume nach Prioritätsänderung neu sortieren

## Problem

Die Inputs verwenden `defaultValue`, das sich nicht aktualisiert wenn React die Komponente mit neuen Props re-rendert. Nach einer Prioritätsänderung wird der Raum in der DB aktualisiert und `rooms` neu geladen, aber die Sortierung im UI ändert sich nicht, weil `defaultValue` den alten Wert behält und React das Input nicht neu erstellt.

## Lösung

`key={room.id + '-' + room.priority}` auf die Input-Elemente setzen (oder auf die TableRow/div). Dadurch erzwingt React ein neues Input mit dem aktualisierten `defaultValue` wenn sich die Priorität ändert. Die Sortierung funktioniert bereits korrekt (`tuyaRooms` wird bei jedem Render neu sortiert), nur das Input zeigt den alten Wert.

## Änderung

**Datei:** `src/components/heating/RoomStatusTable.tsx`

- Zeile 114: `<TableRow key={room.id}>` → `<TableRow key={`${room.id}-${room.priority}`}>`
- Zeile 46: `<div key={room.id}>` → `<div key={`${room.id}-${room.priority}`}>`

Dadurch wird bei Prioritätsänderung die gesamte Zeile neu gerendert und erscheint an der korrekten Position.

