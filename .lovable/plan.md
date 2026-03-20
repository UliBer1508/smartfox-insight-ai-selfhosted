

# Fix: Räume werden trotz Export nicht geheizt

## Problem 1: Stufe 2 Deadband zu strikt

Die Prüfung `currentRoomTemp < comfortTemp - 0.3` schließt Räume aus, die genau auf der Grenze liegen (19.7 < 19.7 = false). Zimmer Luca bleibt dadurch auf target_temp=18.5°C und heizt nicht.

**Fix:** `<` durch `<=` ersetzen: `currentRoomTemp <= comfortTemp - 0.3`

Gleiches für Stufe 1: `currentRoomTemp <= ecoTemp - 0.3`

## Problem 2: `keep`-Aktion korrigiert falsches Target nicht

Wenn die Automation `keep` entscheidet, wird weder Tuya aufgerufen noch das Target aktualisiert. Ein Raum mit target_temp=18.5 bleibt bei 18.5, obwohl er mindestens auf eco (19°C) stehen sollte.

**Fix:** In Stufe 4, wenn `action='keep'` aber `currentTargetTemp < ecoTemp - 1`, dann auf `activate` mit `ecoTemp` setzen. So wird ein falsch niedriges Target korrigiert.

## Änderung

**Datei:** `supabase/functions/pv-automation/index.ts`

### Zeile 1323: Stufe 1 Deadband
```typescript
// Vorher:
if (currentRoomTemp < ecoTemp - 0.3) {
// Nachher:
if (currentRoomTemp <= ecoTemp - 0.3) {
```

### Zeile 1334: Stufe 2 Deadband
```typescript
// Vorher:
} else if (currentRoomTemp < comfortTemp - 0.3 && exportCoversRoom && batteryFull) {
// Nachher:
} else if (currentRoomTemp <= comfortTemp - 0.3 && exportCoversRoom && batteryFull) {
```

### Zeilen 1353-1363: Stufe 4 — falsches Target korrigieren
Nach der bestehenden Stufe-4-Logik eine Korrektur einfügen: Wenn `action === 'keep'` aber das aktuelle Thermostat-Target deutlich unter eco liegt, dann auf eco aktivieren:

```typescript
} else {
  // STUFE 4: Halten
  // ABER: Wenn das aktuelle Thermostat-Target deutlich unter eco liegt, korrigieren
  if (currentTargetTemp < ecoTemp - 1 && exportCoversRoom) {
    action = 'activate';
    targetTemp = ecoTemp;
    reasoning = `🔧 Target-Korrektur: Thermostat bei ${currentTargetTemp}°C statt ${ecoTemp}°C → korrigiere auf Eco`;
  } else {
    action = 'keep';
    targetTemp = currentRoomTemp >= ecoTemp ? ecoTemp : currentTargetTemp;
    if (!exportCoversRoom && currentRoomTemp >= ecoTemp - 0.3) {
      reasoning = `✅ Eco erreicht, Export reicht nicht`;
    } else if (!batteryFull) {
      reasoning = `⏸️ Batterie erst ${batterySoc}%`;
    } else {
      reasoning = `✅ Halten (${currentRoomTemp.toFixed(1)}°C)`;
    }
  }
}
```

