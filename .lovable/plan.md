## Ziel
useSmartfoxData: zwei Timer auf einen reduzieren, ohne die DB-Polling-Frequenz oder Stale-Detection zu verschlechtern.

## Änderung in `src/hooks/useSmartfoxData.ts`

Ein einziger Tick-Loop mit `min(pollingInterval, 30) s`:
- Pro Tick prüfen, ob seit letztem `loadReadings` ≥ `pollingInterval s` vergangen sind → ja: `loadReadings()`, nein: nur lokaler `checkConnectionStatus(currentReading)` (kein DB-Hit).
- `currentReadingRef` (useRef) statt `currentReading` als Effect-Dep, damit der Timer nicht bei jedem neuen Reading neu aufgesetzt wird.
- `lastFetchRef` trackt den letzten DB-Fetch-Zeitstempel.

### Konkret
1. `useRef` hinzufügen: `currentReadingRef`, `lastFetchRef`.
2. In `loadReadings`: nach erfolgreichem Fetch `lastFetchRef.current = Date.now()` setzen.
3. `setCurrentReading(latest)` zusätzlich `currentReadingRef.current = latest` setzen (über Wrapper oder Sync-Effect).
4. Beide bestehenden `useEffect`s (Z. 113–119 und Z. 122–128) durch einen einzigen ersetzen:
   ```ts
   useEffect(() => {
     const tick = Math.min(pollingInterval, 30) * 1000;
     const id = setInterval(() => {
       if (Date.now() - lastFetchRef.current >= pollingInterval * 1000) {
         loadReadings();
       } else {
         checkConnectionStatus(currentReadingRef.current);
       }
     }, tick);
     return () => clearInterval(id);
   }, [pollingInterval, loadReadings, checkConnectionStatus]);
   ```

## Nicht geändert
- Public API des Hooks (`refresh`, returned values).
- `loadReadings`-DB-Frequenz (= `pollingInterval`).
- Toast-Warnung nach 10 min Offline.
- Initial-Load + `loadTotalCount` Effect.
