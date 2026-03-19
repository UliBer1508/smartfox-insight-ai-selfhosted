

# Sequenzielles Heizen reparieren

## Zwei Probleme

### Problem 1: `exportCoversRoom` ignoriert das Budget-System (Zeile 1338)

Das Budget-System (Zeilen 806-852) trackt kumulativ korrekt: Es addiert die Leistung jedes Raums auf und stoppt wenn das Budget voll ist. Aber die 4-Stufen-Logik auf Zeile 1338 macht einen eigenen Check:

```
const exportCoversRoom = gridExport >= roomHeatingPower;
```

Bei 5000W Export sieht **jeder** Raum: "5000W >= meine 600W? JA!" Alle starten gleichzeitig. Das Budget-Ergebnis wird ignoriert.

**Fix:** `exportCoversRoom` durch das Budget-Ergebnis ersetzen:
```
const budgetStatus = roomBudgetStatus.get(room.id);
const exportCoversRoom = budgetStatus?.allowedToHeat === true;
```

### Problem 2: Raum-Reihenfolge stimmt nicht

Aktuell haben Bad Uli, Büro, Wohnzimmer und Zimmer Uli alle **Prioritaet 1**. Die gewuenschte Reihenfolge ist:

| Reihenfolge | Raum | Heizleistung | Neue Prioritaet |
|-------------|------|-------------|-----------------|
| 1 | Bad Uli | 600W | 1 |
| 2 | Zimmer Uli | 1200W | 2 |
| 3 | Zimmer Luis | 1000W | 3 |
| 4 | Zimmer Luca | 1000W | 4 |
| 5 | Buero | 900W | 5 |
| 6 | Wohnzimmer | 2400W | 6 |

Die niedrigeren Raeume (Flur, Kinder Bad, Waschraum, Wirtschaftsraum) behalten ihre aktuelle Prioritaet (wird hoeher als 6).

## Beispiel mit 2000W Export

Budget = 2000W + 400W Toleranz = 2400W:
- Bad Uli (600W) → Rest 1800W ✓
- Zimmer Uli (1200W) → Rest 600W ✓ (beide gleichzeitig!)
- Zimmer Luis (1000W) → 600W < 1000W ✗ → wartet

Wenn Bad Uli fertig ist (600W frei): Zimmer Luis passt → startet.

## Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `pv-automation/index.ts` Zeile 1338 | `exportCoversRoom` aus `roomBudgetStatus` statt `gridExport` |
| Datenbank: `rooms` Tabelle | Prioritaeten aktualisieren: Bad Uli=1, Zimmer Uli=2, Zimmer Luis=3, Zimmer Luca=4, Buero=5, Wohnzimmer=6, restliche Raeume=7 |

