## Ziel

Die Anzeige "+N Eco/Komfort möglich" im Raum-Übersichts-Header zeigt nachts veraltete Werte vom Vortag, weil `system_settings.parallel_heating_capacity` während der Nacht nicht aktualisiert wird (pv-automation kehrt im Night-Branch früh zurück).

Drei kombinierte Maßnahmen — Defense in Depth.

## Änderungen

### 1. `supabase/functions/pv-automation/index.ts` — Night-Reset des Snapshots

Im `if (isNight)`-Branch (ab Zeile 670), **vor** allen frühen Returns, einen Upsert auf `system_settings` einfügen, der den Parallel-Plan auf Nacht-Defaults setzt:

- `max_parallel_eco: 0`, `max_parallel_comfort: 0`
- `eco_budget_w: 0`, `comfort_budget_w: 0`
- `eco_candidates: []`, `comfort_candidates: []`
- `budget_mode: 'night'`
- `computed_at: now()`

So bleibt der Snapshot in jedem 2-min-Heartbeat-Lauf frisch, auch wenn der Quiet-Gate ansonsten ohne Tuya-Calls zurückkehrt.

### 2. `src/hooks/useParallelHeatingCapacity.ts` — `updated_at` mitliefern

Hook erweitern: zusätzlich `updated_at` aus der Zeile zurückgeben (separat oder als `_updated_at`-Property im Daten-Objekt), damit die UI die Frische prüfen kann.

### 3. `src/components/heating/RoomStatusTable.tsx` — Stale- und Night-Filter im Badge

Im Badge-Block (Zeilen 178–198):
- Helper `isCapacityFresh`: `Date.now() - new Date(updated_at).getTime() < 10 * 60 * 1000`
- Helper `isInNightWindow`: anhand `heating_settings.night_start_time` / `night_end_time` und Wien-Zeit prüfen — nutzt vorhandenen Settings-Hook bzw. einen kurzen Settings-Fetch (bereits an anderer Stelle im Codebase verfügbar).
- Badge nur rendern, wenn `capacity && isCapacityFresh && !isInNightWindow && capacity.budget_mode !== 'night'`.
- Auch die äußere Zeilen-Sichtbarkeitsbedingung (Zeile 164: `capacity.comfort_budget_w > 500`) um den Stale-/Night-Check ergänzen, damit die ganze Info-Zeile nicht nur wegen veraltetem Capacity erscheint.

### 4. Sofort-Reset (einmalig)

Den aktuellen `parallel_heating_capacity`-Eintrag direkt per Insert-Tool auf Nacht-Defaults setzen, damit die UI sofort korrekt ist (ohne auf nächsten Heartbeat warten zu müssen).

## Technische Details

- Reset im Edge-Function läuft via `supabase.from('system_settings').upsert(..., { onConflict: 'key' })` — try/catch um Fehler nicht den Night-Flow brechen zu lassen.
- Night-Window-Check in React: Wien-Zeit über `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false })`. Vergleich mit `night_start_time`/`night_end_time` aus `heating_settings` (über-Mitternacht-Logik wie in der Edge-Function).
- Stale-Threshold: 10 min (großzügig, da Heartbeat 2 min ist — ab 5× Misslingen ist Anzeige sicher tot).

## Akzeptanzkriterien

- 06:30 Wien-Zeit, vor `night_end_time=08:00`: Badge wird **nicht** angezeigt (weder "+N Eco" noch "+N Komfort" noch "Budget knapp").
- Tagsüber mit frischem Snapshot (<10 min alt): Badge wie bisher.
- Snapshot älter als 10 min: Badge ausgeblendet, statt veraltete Zahlen zu zeigen.
