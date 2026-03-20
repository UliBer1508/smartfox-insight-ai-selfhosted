

# Priorität editierbar machen

## Änderungen

### 1. RoomManager: Priorität-Feld erweitern (Zeilen 161-176)

Das aktuelle Select hat nur 3 Optionen (Hoch/Mittel/Niedrig = 1-3). Das reicht nicht für die 10 Prioritätsstufen. Ersetzen durch ein Number-Input (1-10) mit Erklärung, dass niedrigere Zahlen = höhere Priorität beim sequenziellen Heizen.

### 2. RoomStatusTable: Priorität editierbar machen

In der Tabelle (Desktop und Mobile) die Prioritätszahl durch ein kleines editierbares Number-Input ersetzen. Bei Änderung wird `onSave` mit der neuen Priorität aufgerufen.

Dafür muss `RoomStatusTable` eine neue `onSave` Prop bekommen, die von der Parent-Komponente durchgereicht wird.

### Dateien

| Datei | Änderung |
|-------|----------|
| `src/components/heating/RoomStatusTable.tsx` | `onSave` Prop hinzufügen, Prio-Spalte als editierbares Input |
| `src/components/heating/RoomManager.tsx` | Select durch Number-Input (1-10) ersetzen |
| `src/components/heating/HeatingDashboard.tsx` | `onSave` an RoomStatusTable durchreichen |

