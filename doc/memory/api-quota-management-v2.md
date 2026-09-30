---
name: Tuya API Quota Management v2
description: Quota protection — dashboard auto-sync disabled, 60min sync gate, dynamic daily limit, push-all quota gate.
type: feature
---

## Tuya API Quota Protection (v2)

**Limits:** 200 Calls/Tag konfiguriert, 3000/Monat. Effektives Tageslimit dynamisch:
```
effectiveDaily = min(configuredDaily, max(30, remainingMonthly / remainingDays)) − 2 (Reserve)
```

### Sync-Verhalten

1. **Dashboard Auto-Sync: deaktiviert.**
   `HeatingDashboard.tsx` macht KEINE 5-Min-Auto-Syncs mehr.
   Stattdessen: DB-Polling alle 60s für `current_temp`, `is_heating` (vom lokalen Collector aktuell gehalten).
   Manueller Refresh-Button bleibt verfügbar.

2. **`tuya-control/sync-all` Last-Sync-Gate: 60 Min.**
   Wenn `last_sync_at < 60min` zurück → DB-Daten zurückgeben, kein Tuya-Call.
   Bypass mit `?force=1`.

3. **`pv-automation` Pre-Sync-Throttle: 360 Min** (6h, unverändert).

4. **`push-all-temps` Quota-Gate:**
   Pusht max so viele Räume, wie das effektive Tagesbudget noch hergibt.
   Räume oberhalb des Limits werden mit `skipped: true` markiert.

5. **`set-temp`** prüft Quota vor jedem Call; bei Erschöpfung 200 mit `quotaExhausted: true`.

### Strategie
Reaktive Heizung (`mem://arch/pv-automation-strategy-v2`) macht ohnehin nur 1 Setpoint-Change pro Raum alle 25 Min → ~12–24 Calls/Tag für Heizungssteuerung + ~4 Pre-Syncs = ~30–50 Calls/Tag total.
