

## Sofort-Aktion: Thermostate JETZT auf Nacht setzen + Quota-Fallback härten

### 1) SQL: 12 Stop-Befehle in `thermostat_commands` queuen
Damit der Local-Service alle aktiven Räume sofort auf `night_temp` (5°C) herunterregelt — umgeht die erschöpfte Tuya-Cloud-Quota komplett.
```sql
INSERT INTO thermostat_commands (room_id, command, value, status)
SELECT id, 'set_temp', COALESCE(night_temp, 5), 'pending'
FROM rooms 
WHERE tuya_device_id IS NOT NULL 
  AND automation_enabled = true;
```

### 2) SQL: Stale Manual-Overrides aufräumen
Alte `manual_override_until`-Einträge vom 17.–19.04. blockieren evtl. künftige Stops.
```sql
UPDATE rooms 
SET manual_override_until = NULL 
WHERE manual_override_until < NOW();
```

### 3) Code-Fix: `setTemperatureForMode` mit DB-Fallback bei Quota-Fehler
In `supabase/functions/pv-automation/index.ts` im Quota-Gate-Block (`setTemperatureForMode`, Cloud-Branch): Statt hartem `return { success: false }` bei `quotaExhausted` automatisch in `thermostat_commands` queuen.
```ts
if (quotaExhausted && !pvPriorityMode) {
  console.log(`[QUOTA-FALLBACK] room=${roomId} temp=${temperature} → Insert thermostat_commands`);
  const { error: insErr } = await supabase.from('thermostat_commands').insert({
    room_id: roomId,
    command: 'set_temp',
    value: temperature,
    status: 'pending',
  });
  if (insErr) {
    return { success: false, errorType: 'quota_exhausted', errorMessage: `Quota+DB-Fallback fehlgeschlagen: ${insErr.message}` };
  }
  return { success: true, action: 'queued_for_local', errorMessage: 'Cloud-Quota erschöpft → Local-Service Queue' };
}
```
Damit greift der Fallback ab sofort bei **jedem** Sende-Versuch (Nacht, SOC-Gate, Eco) — keine separate Code-Pfad-Logik nötig.

### 4) Memory-Update
- `mem://arch/pv-automation-budget-logic-v2`: Quota-Fallback ist jetzt zentral in `setTemperatureForMode` — gilt für jeden Sende-Versuch.
- `mem://features/heating/dual-control-mode-architecture`: Cloud-Modus hat jetzt automatischen DB-Queue-Fallback bei Quota-Exhaustion (kein Mode-Switch, transparenter Hand-off an Local-Service).

## Was unverändert bleibt
- Control-Mode bleibt `cloud` als Default
- 80%-SOC-Regel, Budget-Logik, Phase-Strategie
- Local-Service-Code (interpretiert `set_temp` schon korrekt)

## Voraussetzung
Local-Service muss laufen (`node index.js` auf `C:\Users\ulibe\tuya-thermostat\`). Falls offline: Befehle bleiben `pending` bis Service hochkommt — Tuya-Cloud-Quota wird nicht weiter belastet.

## Erwartetes Verhalten
- **Sofort nach SQL-Insert:** Local-Service holt 12 Befehle innerhalb 30s ab → alle TGP508 auf 5°C
- **Ab nächstem Heartbeat:** jeder weitere Quota-Fehler queued automatisch in DB statt zu scheitern
- **Logs:** `[QUOTA-FALLBACK] room=X temp=Y` statt `Failed: Quota erschöpft`

