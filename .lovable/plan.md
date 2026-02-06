

# Bug-Fix: UI zeigt falschen Heizmodus an

## Problem

Die UI zeigt "Eco" statt "Nacht", obwohl die aktuelle Zeit (07:51 Wien) innerhalb des Nachtmodus-Fensters liegt (20:00-08:00).

## Analyse

Die `isNightTime()` Funktion in `DailyHeatingSchedule.tsx` berechnet korrekt:
- Bei 07:51 (471 Minuten) mit Nacht von 20:00-08:00
- `startMinutes=1200 > endMinutes=480` -> Mitternachtslogik aktiv
- `471 >= 1200 || 471 < 480` = `false || true` = **true**

**Moegliche Ursachen:**

1. **Browser-Zeitzone anders als Europe/Vienna** - Die Funktion nutzt `new Date()` (lokale Browser-Zeit)
2. **Settings werden nicht geladen** - Default-Werte (22:00-06:00) werden verwendet
3. **Timing-Problem** - Die Settings werden nach dem ersten Render geladen

## Loesung

### Schritt 1: Debug-Logging hinzufuegen (temporaer)

Datei: `src/components/heating/DailyHeatingSchedule.tsx`

```text
// Nach Zeile 80, vor currentMode useMemo:
console.log('[DailyHeatingSchedule] Settings check:', {
  nightStart,
  nightEnd,
  settingsNightStart: settings.night_start_time,
  settingsNightEnd: settings.night_end_time,
  browserTime: new Date().toLocaleTimeString('de-AT'),
  browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
});
```

### Schritt 2: Explizite Zeitzone verwenden

Datei: `src/components/heating/DailyHeatingSchedule.tsx`

Die `isNightTime()` Funktion aendern, um explizit die Wiener Zeitzone zu verwenden:

```typescript
function isNightTime(nightStart: string, nightEnd: string): boolean {
  // Explizit Wiener Zeit verwenden
  const viennaTime = new Date().toLocaleString('en-US', { 
    timeZone: 'Europe/Vienna',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false 
  });
  const [hours, minutes] = viennaTime.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;
  
  const [startH, startM] = nightStart.split(':').map(Number);
  const [endH, endM] = nightEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
```

### Schritt 3: Fallback fuer Settings verbessern

Das Zeitformat aus der Datenbank (`20:00:00`) muss auf `HH:MM` normalisiert werden:

```typescript
// Zeile 75-76: Zeit-String normalisieren
const nightStart = (settings.night_start_time || '22:00').substring(0, 5);
const nightEnd = (settings.night_end_time || '06:00').substring(0, 5);
```

## Zusammenfassung der Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `src/components/heating/DailyHeatingSchedule.tsx` | `isNightTime()` auf Europe/Vienna Zeitzone umstellen |
| `src/components/heating/DailyHeatingSchedule.tsx` | Zeit-Strings auf HH:MM normalisieren (substring 0-5) |

## Erwartetes Ergebnis

- Die UI zeigt korrekt "Nacht" an, solange die Wiener Zeit zwischen 20:00 und 08:00 liegt
- Unabhaengig von der Browser-Zeitzone wird die korrekte Ortszeit verwendet
- Das Zeitformat aus der DB (HH:MM:SS) wird korrekt verarbeitet

