

# Analyse: Zeitzonen-Konsistenz im Frontend

## Zusammenfassung

Die Untersuchung zeigt, dass **mehrere kritische Stellen** im Frontend die Browser-Zeitzone statt der expliziten Wiener/Berliner Zeit verwenden. Dies kann zu Fehlern fuehren, wenn der Browser in einer anderen Zeitzone laeuft.

## Problemstellen

### KRITISCH: Zeitzonen-Fehler bei Logik-Entscheidungen

| Datei | Funktion | Problem |
|-------|----------|---------|
| `src/components/heating/ThermostatCard.tsx` | `activeMode` (Zeile 110-124) | `now.getHours()` ohne Zeitzone |
| `src/hooks/useRooms.ts` | `getCurrentRecommendation` (Zeile 135-144) | `now.getHours()` ohne Zeitzone |
| `src/hooks/useConsumptionAnalysis.ts` | `activeConsumers` (Zeile 64-65) | `now.getHours()` ohne Zeitzone |
| `src/pages/Index.tsx` | `currentHour` (Zeile 124-125) | `now.getHours()` ohne Zeitzone |
| `src/components/heating/HeatingDashboard.tsx` | `currentHour` (Zeile 228-229) | `now.getHours()` ohne Zeitzone |
| `src/lib/dateUtils.ts` | Alle Funktionen | Browser-Zeitzone statt explizit |

### OK: Bereits korrekt implementiert

| Datei | Verwendung |
|-------|------------|
| `src/components/heating/DailyHeatingSchedule.tsx` | `Europe/Vienna` explizit |
| `src/components/energy/BatteryHistoryChart.tsx` | `Europe/Berlin` fuer Anzeige |
| `src/components/energy/EnergyChart.tsx` | `Europe/Berlin` fuer Anzeige |
| Backend Edge Functions | `Europe/Vienna` oder `Europe/Berlin` explizit |

### Inkonsistenz: Berlin vs Vienna

- Frontend: Meist `Europe/Berlin`
- Backend (`pv-automation`): `Europe/Vienna`
- Technisch identisch, aber verwirrend

## Loesung

### Schritt 1: Zentrale Hilfsfunktion in dateUtils.ts erweitern

```typescript
// src/lib/dateUtils.ts

const TIMEZONE = 'Europe/Vienna';

/**
 * Aktuelle Wiener Zeit als Stunde (0-23)
 */
export function getViennaHour(): number {
  return parseInt(new Date().toLocaleTimeString('de-AT', { 
    timeZone: TIMEZONE, 
    hour: '2-digit', 
    hour12: false 
  }));
}

/**
 * Aktuelle Wiener Zeit als HH:MM String
 */
export function getViennaTimeString(): string {
  return new Date().toLocaleTimeString('de-AT', { 
    timeZone: TIMEZONE, 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

/**
 * Aktuelle Wiener Zeit als Minuten seit Mitternacht
 */
export function getViennaMinutesSinceMidnight(): number {
  const time = new Date().toLocaleTimeString('en-US', { 
    timeZone: TIMEZONE, 
    hour: 'numeric', 
    minute: 'numeric',
    hour12: false 
  });
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Lokales Datum (Vienna) als String (YYYY-MM-DD)
 */
export function getLocalDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}
```

### Schritt 2: ThermostatCard.tsx korrigieren

```typescript
// Zeile 110-124 ersetzen mit:
import { getViennaMinutesSinceMidnight } from '@/lib/dateUtils';

const activeMode = useMemo((): ActiveMode => {
  const currentMinutes = getViennaMinutesSinceMidnight();
  const nightStart = parseTimeToMinutes(nightStartTime);
  const nightEnd = parseTimeToMinutes(nightEndTime);
  
  const isNight = nightStart > nightEnd 
    ? (currentMinutes >= nightStart || currentMinutes < nightEnd)
    : (currentMinutes >= nightStart && currentMinutes < nightEnd);
  
  if (isNight) return 'night';
  if (room.pv_auto_active) return 'comfort';
  return 'eco';
}, [nightStartTime, nightEndTime, room.pv_auto_active]);
```

### Schritt 3: useRooms.ts korrigieren

```typescript
// Zeile 135-144 ersetzen mit:
import { getViennaTimeString } from '@/lib/dateUtils';

const getCurrentRecommendation = useCallback((roomId: string): RoomRecommendation | undefined => {
  const currentTime = getViennaTimeString();
  
  return recommendations.find(rec => 
    rec.room_id === roomId && 
    rec.start_time <= currentTime && 
    rec.end_time > currentTime
  );
}, [recommendations]);
```

### Schritt 4: useConsumptionAnalysis.ts korrigieren

```typescript
// Zeile 64-65 ersetzen mit:
import { getViennaTimeString } from '@/lib/dateUtils';

const currentTime = getViennaTimeString();
```

### Schritt 5: Index.tsx und HeatingDashboard.tsx korrigieren

```typescript
// Beide Dateien: currentHour-Berechnung ersetzen mit:
import { getViennaHour } from '@/lib/dateUtils';

const currentHour = getViennaHour();
```

## Zusammenfassung der Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `src/lib/dateUtils.ts` | Neue Funktionen: `getViennaHour`, `getViennaTimeString`, `getViennaMinutesSinceMidnight` |
| `src/components/heating/ThermostatCard.tsx` | Import + Verwendung von `getViennaMinutesSinceMidnight` |
| `src/hooks/useRooms.ts` | Import + Verwendung von `getViennaTimeString` |
| `src/hooks/useConsumptionAnalysis.ts` | Import + Verwendung von `getViennaTimeString` |
| `src/pages/Index.tsx` | Import + Verwendung von `getViennaHour` |
| `src/components/heating/HeatingDashboard.tsx` | Import + Verwendung von `getViennaHour` |

## Erwartetes Ergebnis

- Alle zeit-basierten Logik-Entscheidungen verwenden konsistent die Wiener Zeitzone
- Unabhaengig von der Browser-Zeitzone des Benutzers wird die korrekte Ortszeit verwendet
- Nachtmodus, Empfehlungen und Verbrauchsanalyse zeigen korrekte Daten

