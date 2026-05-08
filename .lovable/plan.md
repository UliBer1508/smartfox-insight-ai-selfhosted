## Problem

`node auto-discovery.js` zeigt "Keine Räume mit tuya_device_id und local_key!", obwohl alle 12 Räume in der DB korrekt befüllt sind.

**Root Cause:** Die RLS-Policies auf `public.rooms` erlauben dem Anon-Key nur **UPDATE**, aber kein **SELECT**. Der lokale Service liest mit dem Anon-Key → bekommt 0 Räume zurück.

Zum Vergleich: `thermostat_commands` hat sowohl SELECT als auch UPDATE für anon. `rooms` fehlt die SELECT-Policy.

Der zweite Fehler (`uv_handle assertion in async.c`) ist ein Node/libuv-Folgefehler beim Hard-Exit, sobald das Skript wegen "0 Räume" abbricht während Tuya-Discovery-Sockets noch offen sind. Verschwindet automatisch, sobald Ursache 1 behoben ist.

## Lösung

### Migration: SELECT-Policy für anon auf `rooms`

```sql
CREATE POLICY "Anon collector can read rooms"
ON public.rooms
FOR SELECT
TO anon
USING (true);
```

Das ist konsistent mit:
- `thermostat_commands` (anon SELECT + UPDATE)
- `data_retention_settings` (anon SELECT)
- `battery_daily_tracking` (anon SELECT + INSERT + UPDATE)
- `service_health` (anon SELECT + INSERT + UPDATE)

### Memory-Update

`mem://auth/rls-policies-local-collector` ergänzen: `rooms` braucht SELECT für anon (nicht nur UPDATE), damit lokale Services Konfiguration lesen können.

## Was NICHT geändert wird

- Keine Code-Änderungen am `tuya-thermostat-v2/` Service (liegt lokal beim User)
- Keine Edge-Functions
- Kein UI

## Nach der Migration

User führt nochmals aus:
```cmd
node auto-discovery.js
```
→ sollte alle 12 Räume listen und Discovery starten.