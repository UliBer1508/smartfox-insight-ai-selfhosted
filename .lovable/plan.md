

# Prioritätsbereich auf 1-12 erweitern

## Änderungen

| Datei | Änderung |
|-------|----------|
| `src/components/heating/RoomManager.tsx` | Label "1–10" → "1–12", `Math.min(10, ...)` → `Math.min(12, ...)`, `max` Attribut auf 12 |
| `src/components/heating/RoomStatusTable.tsx` | Validierung `num <= 10` → `num <= 12`, Input `max` auf 12 |

Keine Datenbank-Änderung nötig — die `priority`-Spalte ist ein `integer` ohne Constraint.

