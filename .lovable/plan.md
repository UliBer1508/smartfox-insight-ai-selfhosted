

# Fix: Quota-Counter zählt geblockte Calls mit

## Problem

Der Quota-Counter (`calls_today`, `calls_this_month`) wird auch dann hochgezählt, wenn der **QUOTA-GATE** den API-Call blockiert hat. Das passiert an 3 Stellen:

- Zeile 1755: `if (controlMode === 'cloud') tuyaApiCalls++` nach `activate`
- Zeile 1811: `if (controlMode === 'cloud') tuyaApiCalls++` nach `deactivate`  
- Zeile 1298: `if (controlMode === 'cloud') tuyaApiCalls++` nach Over-Temp-Stop

Diese Zeilen prüfen nur `controlMode === 'cloud'`, nicht ob der Call tatsächlich durchging. Da die Automation alle 2 Minuten läuft und 10-12 Räume verarbeitet, werden **pro Stunde ~300 Phantom-Calls** zum Counter addiert — obwohl kein einziger realer API-Call stattfindet.

**Zeile 1932-1935** persistiert dann diese falschen Zahlen:
```
quotaData.calls_this_month += tuyaApiCalls;
quotaData.calls_today += tuyaApiCalls;
```

Ergebnis: 1708/33 heute laut Counter, aber real vermutlich nur ~33 echte Calls bevor die Quota griff.

## Lösung

### Änderung 1: `tuyaApiCalls` nur bei echtem API-Call zählen

An allen 3 Stellen (Zeilen 1298, 1755, 1811) die Bedingung ändern:

```typescript
// ALT:
if (controlMode === 'cloud') tuyaApiCalls++;

// NEU:
if (controlMode === 'cloud' && result.success) tuyaApiCalls++;
```

Nur erfolgreiche Calls verbrauchen echte Quota. Geblockte Calls (quota_exhausted, config errors) dürfen den Counter nicht erhöhen.

### Änderung 2: Quota-Counter zurücksetzen

Da der Counter jetzt massiv aufgeblasen ist, muss er beim nächsten Tageswechsel korrekt auf 0 zurückgesetzt werden. Die bestehende Reset-Logik (Zeile 394-397) funktioniert bereits — aber der aufgeblähte `calls_this_month` (5328) bleibt bis zum Monatswechsel falsch und blockiert weiterhin alles.

Zusätzliche Sicherheit: Wenn `quotaExhausted` bereits `true` ist am Anfang des Runs, die Schleife über alle Räume **komplett überspringen** (Early Return nach Budget/Pre-Sync), da alle API-Calls sowieso geblockt werden und nur den Counter weiter aufblasen.

### Änderung 3: Monats-Counter korrigieren

Da `calls_this_month = 5328` weit über dem Limit liegt und bis Monatsende blockiert, muss der Wert einmalig auf einen realistischen Wert zurückgesetzt werden. Dies kann durch eine Plausibilitätsprüfung beim Laden erfolgen: Wenn `calls_this_month > monthly_limit * 3`, auf `monthly_limit` zurücksetzen (konservativ, blockiert erstmal weiter, wird aber beim Tageswechsel korrekt).

### Betroffene Datei
`supabase/functions/pv-automation/index.ts`

