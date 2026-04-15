

## Plan: Modus 'home' bei jedem Temperatur-Befehl mitschicken

### Problem
Die TGP508-Thermostate haben interne Zeitprogramme (Modus 'auto'/'program'), die remote gesetzte Temperaturen überschreiben. Lösung: Bei jedem `temp_set`-Befehl auch `mode: 'home'` senden, was den Thermostaten in den manuellen (nicht-programmierbaren) Modus versetzt.

### Bisheriger Stand
- Kommentar in Code: "Mode command ('home') removed - causes Error 2008"
- **Aber**: Der Endpoint `/set-mode-all` in `tuya-control` nutzt `setDeviceMode('home')` erfolgreich als separaten Call
- Vermutung: Error 2008 trat auf wenn `mode` und `temp_set` im selben Commands-Array waren

### Lösung: Beide Commands in einem API-Call senden

Statt 2 separate API-Calls (verdoppelt Quota-Verbrauch) → beide Commands im selben Array:

```typescript
const commands = [
  { code: 'mode', value: 'home' },
  { code: 'temp_set', value: Math.round(temperature * 10) }
];
```

**Betroffene Stellen (3 Dateien):**

1. **`supabase/functions/pv-automation/index.ts`** Zeile 157: `commands`-Array um `mode: 'home'` erweitern
2. **`supabase/functions/tuya-control/index.ts`** Zeile 234: gleiche Änderung
3. **`supabase/functions/apply-recommendations/index.ts`**: gleiche Funktion `setDeviceTemperature` anpassen
4. **Lokal-Modus**: In `queueLocalTemperatureCommand` zusätzlich einen `set_mode`-Befehl queuen, und in `collector-node/tuya-thermostat.js` vor `temp_set` den Modus auf `manual` setzen

### Fallback-Strategie
Falls der kombinierte Call Error 2008 liefert: Split in 2 separate Calls (mode zuerst, dann temp). Dies kostet 2 API-Calls statt 1, spart aber gegenüber dem jetzigen Zustand (wo Thermostate die Temp ständig überschreiben und Resync-Calls nötig sind).

### Quota-Auswirkung
- **Best case** (kombinierter Call): 0 extra API-Calls
- **Worst case** (separate Calls): 1 extra Call pro Temperatur-Änderung
- **Aktuell**: Resync alle 30 Min verbraucht deutlich mehr Quota

