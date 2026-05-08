## Problem

**Raumübersicht:** "Wirtschaftsraum heizt" (rotes Symbol)
**Local-Service-Anzeige:** "Kein Raum heizt"

**Ursache:** Datenkonflikt in der Quelle.

In `room_heating_logs` existiert ein `heating_start` um 06:00 UTC für den Wirtschaftsraum — aber **kein zugehöriges `heating_stop`**. Der Stufe-A-Algorithmus in `useActiveHeatingRooms.ts` zählt Starts vs. Stops und schließt: "Zyklus ist offen → Raum heizt seit 4h".

Realität:
- `rooms.is_heating = false`
- `current_temp = 19.7°C`, `target_temp = 19°C` (über Hysterese-Aus-Schwelle 19.3°C)
- `last_thermostat_sync` < 1min — also frisch
- Local-Service liefert die Wahrheit: nichts heizt

Der `heating_stop` wurde irgendwann zwischen 06:00 und jetzt verpasst (Polling-Lücke beim Übergang).

## Fix in 2 Teilen

### Teil 1 — Sofort: verwaisten Start-Log korrigieren

Synthetischen `heating_stop` einfügen, damit der offene Zyklus geschlossen wird und das Banner sofort verschwindet:

```sql
INSERT INTO room_heating_logs (room_id, event_type, timestamp, duration_minutes)
SELECT 
  (SELECT id FROM rooms WHERE name='Wirtschaftsraum'),
  'heating_stop',
  NOW(),
  EXTRACT(EPOCH FROM (NOW() - '2026-05-08 06:00:09.348+00'::timestamptz))/60;
```

### Teil 2 — Reconciliation in der UI

Stufe A blind den Logs zu vertrauen ist die eigentliche Schwäche. Wenn ein Raum in den Logs als "offen" gilt, **aber** parallel:
- `is_heating = false` UND
- Sync ist frisch (< 10 min)

…dann ist die Realität (`is_heating=false`) verlässlicher als ein verwaister Log. Diesen Cross-Check in `src/hooks/useActiveHeatingRooms.ts` (Zeilen 156–171) ergänzen:

```ts
for (const [roomId, c] of roomEventCounts) {
  if (c.starts > c.stops && c.lastStart) {
    const room = roomMap.get(roomId);
    if (!room) continue;

    // Reconciliation: Wenn Sync frisch ist UND is_heating=false,
    // ist der offene Log-Zyklus ein verwaister Start (heating_stop nicht geloggt).
    const syncMs = room.last_thermostat_sync 
      ? now - new Date(room.last_thermostat_sync).getTime() 
      : Infinity;
    if (room.is_heating === false && syncMs < SYNC_FRESH_SEC * 1000) {
      console.warn(`[ActiveHeatingRooms] Verwaister offener Zyklus für ${room.name} ignoriert (is_heating=false, sync=${Math.round(syncMs/1000)}s)`);
      continue;
    }

    const startMs = new Date(c.lastStart).getTime();
    fromLogs.push({ /* …unverändert… */ });
  }
}
```

## Resultat

- Banner zeigt sofort "kein Raum heizt" — konsistent mit dem Local-Service
- Künftige verwaiste Start-Logs werden automatisch ignoriert, sobald der Local-Service `is_heating=false` meldet und der Sync frisch ist
- Echte aktive Räume (mit `is_heating=true` oder stale Sync) werden weiterhin korrekt aus den Logs angezeigt