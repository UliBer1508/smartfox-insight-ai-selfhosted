# Problem
Die Raum-Übersicht zeigt 0 heizende Räume, obwohl real Räume heizen sollten.

**Root cause aus DB-Analyse:**
1. `room_heating_logs` enthält **0 Events der letzten 24 h** → die UI-Quelle (`useActiveHeatingRooms`) hat nichts zum Anzeigen.
2. `pv-automation` Edge Function-Logs zeigen nur "shutdown" — die Funktion schreibt aktuell keine Heizevents.
3. Tuya-Cloud-Sync ist bei einigen Räumen >1 h alt (`last_thermostat_sync` 07:36–10:44 UTC).
4. `last_heating_start` aller 12 Räume steht auf exakt 11:34:02 UTC — wirkt wie ein Massen-Reset, nicht wie reale Heiz-Events.

# Plan

## 1. pv-automation Health-Check & Reaktivierung
- `supabase/functions/pv-automation/index.ts`: prüfen, ob `room_heating_logs`-Inserts beim Aktivieren/Deaktivieren tatsächlich ausgeführt werden (kein Try/Catch das stillschweigend swallowed).
- pg_cron-Job für `pv-automation` (2-Min-Heartbeat) verifizieren — falls disabled/error, neu einrichten.
- Manuellen Einmal-Trigger ausführen und Logs prüfen.

## 2. Hybrid-Quelle in `useActiveHeatingRooms`
Aktuell strikt log-basiert → fällt auf 0 zurück, sobald Logs fehlen. Erweitern auf **dreistufigen Fallback**:
- **Stufe A (primär):** `room_heating_logs` der letzten 4 h mit offenen Zyklen (wie bisher).
- **Stufe B (Fallback bei leeren Logs <30 min):** Räume mit `is_heating = true` UND `last_thermostat_sync` jünger als 10 min.
- **Stufe C (Stale-Indicator):** Wenn weder A noch B verfügbar und letzter Sync >15 min → UI zeigt Warn-Badge "Heizstatus veraltet — letzter Sync vor X min".

Das verhindert leere UI bei Log-Lücken, ohne `mem://arch/active-heating-status-source` aufzuweichen — die Memory wird ergänzt um den dokumentierten Fallback.

## 3. UI-Diagnoseanzeige in `RoomStatusTable.tsx`
- Header zeigt zusätzlich: "Letzter Tuya-Sync vor X min" (max über alle Räume).
- Bei Stufe C: gelbes Warn-Banner über der Tabelle mit Hinweis und Button "Jetzt synchronisieren" (triggert `tuya-control` push-all).

## 4. Memory-Update
- `mem://arch/active-heating-status-source`: Fallback-Kaskade A→B→C dokumentieren.
- Neue Memory `mem://features/heating/heating-status-fallback-cascade.md` mit Schwellenwerten (4 h, 10 min, 15 min).

# Geänderte Dateien
- `supabase/functions/pv-automation/index.ts` (Logging-Fix, falls nötig)
- `src/hooks/useActiveHeatingRooms.ts` (Fallback-Kaskade)
- `src/components/heating/RoomStatusTable.tsx` (Sync-Indicator + Warn-Banner)
- `mem://arch/active-heating-status-source` (Update)
- `mem://features/heating/heating-status-fallback-cascade.md` (neu)

# Was ich NICHT anfasse
- Strikte Log-Priorität bleibt bestehen — `is_heating` ist nur Fallback, nie primäre Quelle.
- Komfort-/Eco-Budget-Logik unverändert.
