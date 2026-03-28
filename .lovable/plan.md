

# Fix: Monatliche Quota wird nicht dynamisch überwacht

## Problem

Die Quota wird nur **einmal am Anfang** des Runs geprüft (Zeile 409). Während der Verarbeitung der Räume wird `quotaExhausted` **nie aktualisiert**. Das bedeutet:

1. **Mid-Run Überschreitung**: Bei 33 Daily-Limit und 12 Räumen — wenn der Run mit 30/33 startet, werden trotzdem alle 12 Räume verarbeitet → 42/33 am Ende
2. **Pre-Sync zählt nicht zum Gate**: Der Pre-Sync addiert 2 Calls (Zeile 734), aber `quotaExhausted` bleibt `false`
3. **Kein Schutz vor Monats-Überschreitung im laufenden Run**: `calls_this_month` wird hochgezählt, aber nie gegen `monthlyLimit` re-geprüft

## Lösung

### Änderung 1: Dynamische Quota-Prüfung nach jedem erfolgreichen Call

Nach jeder `tuyaApiCalls++` Stelle und nach Pre-Sync die laufenden Zähler gegen die Limits prüfen und `quotaExhausted` dynamisch auf `true` setzen:

```typescript
if (controlMode === 'cloud' && result.success) {
  tuyaApiCalls++;
  // Dynamisch prüfen ob Quota jetzt erschöpft
  if (quotaData) {
    const runningTotal = quotaData.calls_today + tuyaApiCalls;
    const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
    if (runningTotal >= (quotaData.daily_limit || 33) || runningMonthly >= (quotaData.monthly_limit || 900)) {
      quotaExhausted = true;
      console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls`);
    }
  }
}
```

### Änderung 2: Pre-Sync Quota-Update ins Gate einspeisen

Nach Pre-Sync (Zeile 734-735) ebenfalls `quotaExhausted` re-evaluieren:

```typescript
if (quotaData) {
  quotaData.calls_this_month += 2;
  quotaData.calls_today += 2;
  // Re-check quota after sync
  if (quotaData.calls_today >= (quotaData.daily_limit || 33) || 
      quotaData.calls_this_month >= (quotaData.monthly_limit || 900)) {
    quotaExhausted = true;
  }
}
```

### Änderung 3: Budget-Reserve für Sicherheit

Statt `>=` Limit als Gate, eine Reserve von 2 Calls einbauen (für evtl. Nacht-Frost-Schutz):

```typescript
const effectiveDailyLimit = dailyLimit - 2; // 2 Reserve für Notfall
```

### Betroffene Datei
`supabase/functions/pv-automation/index.ts` — 3 Stellen für dynamische Quota + Pre-Sync + Reserve

