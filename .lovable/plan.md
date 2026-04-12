

# Vorschlag: Fortschrittsbalken pro Raum zur Zieltemperatur

## Konzept

Jede Zeile in der Raum-Übersicht bekommt einen schmalen Fortschrittsbalken, der visuell zeigt, wie weit die aktuelle Temperatur (`current_temp`) vom Ziel (`target_temp`) entfernt ist.

```text
Bad Uli    19.6° ████████████████████░░  20°   (-0.4°)
Büro       18.7° ████████████░░░░░░░░░░  20°   (-1.3°)
Flur       20.0° ████████████████████████ 20°   (✓)
```

### Darstellung

- **Balken**: Farbiger Fortschrittsbalken (Progress-Komponente) zwischen `current_temp` und `target_temp`
- **Farbe**: Grün wenn Ziel erreicht (≥ target - 0.2°), Orange wenn nahe dran, Rot wenn > 1.5° fehlen
- **Text rechts**: Differenz in °C (z.B. „-0.4°" oder „✓" wenn erreicht)
- **Berechnung**: `progress = Math.min(100, Math.max(0, (current - night) / (target - night) * 100))`
  - `night_temp` als Untergrenze (0%), `target_temp` als Obergrenze (100%)

### Desktop-Tabelle
- Neue Spalte **"Fortschritt"** nach "Ziel", mit schmalem Balken (80px breit) + Differenz-Text

### Mobile-Ansicht
- Balken unterhalb der Temperatur-Zeile, volle Breite

## Betroffene Datei
- `src/components/heating/RoomStatusTable.tsx` — Progress-Balken + Differenz-Anzeige hinzufügen

## Beispiel-Logik

```typescript
const getProgress = (room: Room) => {
  if (room.current_temp == null || room.target_temp == null) return null;
  const night = room.night_temp ?? 16;
  const range = room.target_temp - night;
  if (range <= 0) return { percent: 100, diff: 0 };
  const percent = Math.min(100, Math.max(0, ((room.current_temp - night) / range) * 100));
  const diff = room.target_temp - room.current_temp;
  return { percent, diff: Math.round(diff * 10) / 10 };
};

// Farbe basierend auf Differenz
const getColor = (diff: number) => {
  if (diff <= 0.2) return 'bg-green-500';    // Ziel erreicht
  if (diff <= 1.0) return 'bg-orange-400';   // Fast da
  return 'bg-red-400';                        // Noch weit weg
};
```

