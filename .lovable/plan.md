

## Problem: Error 2008 blockiert alle Temperatur-Befehle

### Ursache
Die letzte Änderung (kombiniertes `mode: 'home'` + `temp_set` im selben Commands-Array) wird von den TGP508-Thermostaten **nicht unterstützt**. Error 2008 = "command or value not support". Dadurch schlagen **alle** Temperatur-Befehle fehl → Räume bleiben auf Nacht-Werten.

### Lösung: Zwei separate API-Calls statt einem kombinierten

**Strategie:** `mode: 'home'` als **separaten Call VOR** dem `temp_set` senden. Der Endpoint `/set-mode-all` in `tuya-control` macht das bereits erfolgreich mit `setDeviceMode()`.

**Änderungen in 3 Edge Functions:**

1. **`supabase/functions/pv-automation/index.ts`** (Zeile 156-159):
   - `setDeviceTemperature` zurück auf nur `temp_set`
   - Neue Funktion `setDeviceMode(deviceId, 'home')` als separater API-Call
   - Vor dem ersten `temp_set` eines Zyklus einmal `mode: 'home'` senden
   - **Quota-Optimierung:** Mode nur 1x pro Raum pro Stunde senden (nicht bei jedem 2-Min-Zyklus)

2. **`supabase/functions/tuya-control/index.ts`** (gleiche Änderung):
   - `setDeviceTemperature` Commands-Array zurück auf nur `[{ code: 'temp_set', value }]`
   - Mode-Setzung bleibt als separater Endpoint `/set-mode-all`

3. **`supabase/functions/apply-recommendations/index.ts`** (gleiche Änderung)

**Konkret für `setDeviceTemperature`:**
```typescript
// VORHER (Error 2008):
const commands = [
  { code: 'mode', value: 'home' },
  { code: 'temp_set', value: Math.round(temperature * 10) }
];

// NACHHER (funktioniert):
const commands = [
  { code: 'temp_set', value: Math.round(temperature * 10) }
];
```

**Mode-Setzung in pv-automation:** Einmal zu Beginn des Tageszyklus (09:00) und danach stündlich alle Thermostate auf `mode: 'home'` setzen — als separater API-Call pro Gerät. Das kostet max 12 extra Calls/Stunde, verhindert aber dass interne Programme überschreiben.

**Lokaler Modus:** Bleibt unverändert (DPS-Befehle können sequentiell gesendet werden).

### Auswirkung
- Temperatur-Befehle funktionieren sofort wieder
- Räume werden auf eco/comfort gesetzt wenn Budget vorhanden
- Mode wird stündlich separat erzwungen statt bei jedem temp_set

