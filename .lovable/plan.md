# Robustheit: 3 Absicherungen

Absicherung 3 (Quota) entfällt — Control-Mode ist `local`, Tuya Cloud inaktiv.

---

## 1. PV-Forecast-Fallback (Backend)

**Datei:** `supabase/functions/pv-automation/index.ts`

Direkt nach dem Laden von `pvForecast` (heute):
- Wenn `null` oder `expected_kwh === 0` → letzten Eintrag aus `pv_forecasts` der letzten **3 Tage** laden (`order date desc limit 1`).
- `forecastIsStale = !todayForecast && !!fallback`.
- `expectedPvKwh = todayForecast?.expected_kwh ?? fallback?.expected_kwh ?? 0`.
- Bei Stale: Komfort-Budget konservativ mit Faktor **0.7** (vermeidet Überheizen bei veralteter Sonnenprognose).
- Hard PV-Gate (<500 W + <5 kWh) greift erst, wenn auch Fallback `0` liefert.
- Log: `[PV-FORECAST] Stale fallback from {date}: {kwh} kWh (×0.7 budget)`.
- Reasoning-Feld der Recommendation bekommt `forecast_stale: true`.

## 2. Phase-1-Deadlock-Schutz (Backend)

**Datei:** `supabase/functions/pv-automation/index.ts`

Neue Helper-Funktion:
```
isRoomStale(room) = !last_thermostat_sync || (now - sync) > 2h
```

- In `phase1Complete`-Check: stale Räume zählen als „fertig" → blockieren Phase 2 nicht.
- In Phase-2-Allokation: stale Räume werden **übersprungen** (kein Komfort-Push an Offline-Thermostat).
- Log: `[PHASE-1] Skipped stale room {name} ({minutes}min since last sync)`.

**Frontend:** In `src/components/heating/RoomStatusTable.tsx` (bzw. Raumkarte) ein orange Badge **„Thermostat offline – letzter Sync vor Xh"** wenn `isRoomStale`. Bestehende Stale-Banner-Komponente wiederverwenden, Schwelle 2 h.

## 3. ML-Cache-Alter (Frontend)

**Datei:** `src/components/heating/AutomationStatusCards.tsx`

Neue Zeile in der Automations-Status-Karte:
- Quelle: `system_settings.last_ml_cache.timestamp`.
- `< 45 min`: neutral grau – „KI-Entscheidungen: vor X min berechnet"
- `≥ 45 min`: gelb – „KI-Analyse wird beim nächsten Heartbeat erneuert (vor X min)"
- Polling 60 s über bestehenden `useQuery`-Mechanismus, kein Refresh-Button.

---

## Technische Details

- **Keine DB-Migration nötig** – alle Daten existieren (`pv_forecasts`, `rooms.last_thermostat_sync`, `system_settings`).
- **Deploy:** `pv-automation` Edge Function nach Änderung neu deployen.
- **Stale-Schwellen:** Phase-Gate = 2 h (hart, da Heizentscheidung); Dashboard-Banner bleibt bei bestehenden 10/15 min (Memory `heating-status-fallback-cascade`).
- **Memory-Update nach Implementierung:**
  - `mem://features/heating/safety-gate-low-pv-logic` → 3-Tage-Stale-Fallback + 0.7-Faktor ergänzen
  - `mem://arch/pv-automation-strategy-v2` → Stale-Räume blockieren Phase 2 nicht
