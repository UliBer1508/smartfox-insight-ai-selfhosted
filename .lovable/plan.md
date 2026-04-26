## Problem

Bei 9.8 kW Export werden Räume nacheinander hochgefahren statt **mehrere parallel**. Der Algorithmus berücksichtigt zwar `usedBudget + roomPower ≤ budget` sequentiell, aber:

1. **Kein Lookahead:** Die stündliche PV-Prognose wird nur als Eco-Fallback bei wenig PV genutzt — nicht um bei sicherer Sonne mehr Räume parallel auf Komfort hochzuziehen.
2. **Trend wird unterschätzt:** Nur Bonus +500 W bei Trend > 500 W. Fallender Trend wird ignoriert (außer für Eco-Toleranz).
3. **Kein Baseload-Puffer:** Schwankende Hausverbraucher (Backofen, Mikrowelle) können das Budget kurzzeitig kippen → unnötige Deaktivierungen.
4. **Keine Sichtbarkeit:** User sieht nicht, wie viel Kapazität noch frei ist und wie viele Räume parallel möglich wären.

## Lösung

### 1. `supabase/functions/pv-automation/index.ts` — Budget-Berechnung erweitern (~Z. 1280–1480)

**a) Dynamischer Baseload-Puffer berechnen** (vor Komfort-Budget-Berechnung):
- Aus den letzten 10 `energy_readings` (~10 Min) die **Standardabweichung der `consumption`** berechnen.
- `dynamicBaseloadBuffer = clamp(stddev × 1.5, 200, 1500)` Watt.
- Logging: `[BASELOAD-BUFFER] Stddev=Xw, Puffer=Yw → wird vom Komfort-Budget abgezogen`.

**b) Symmetrischer PV-Trend-Faktor** (ersetzt aktuelle Z. 1422–1425):
- `trendBonus = pvTrend × 0.5` (positiv ODER negativ, kein Threshold mehr).
- Auf Eco-Budget UND Komfort-Budget anwenden (bisher nur Eco).
- Clamp: `[-1500, +1500]` Watt um Extremwerte abzufedern.
- Begründung: Bei Trend +1000 W/5min → +500 W Komfort-Budget mehr (zieht Räume hoch). Bei Trend -800 W/5min → -400 W (blockiert neue Aktivierungen früher).

**c) Prognose-Lookahead-Bonus für Komfort** (neu):
- Hole `nextHourForecast = hourly_watts[stunde+1] × forecastAccuracy`.
- Wenn `nextHourForecast ≥ currentHourForecastCorrected × 0.9` (kommende Stunde mind. so gut):
  - `comfortLookaheadBonus = Math.min(gridExport × 0.3, nextHourForecast - baseLoad - 1000)`
  - `comfortBudget += comfortLookaheadBonus` (max +30% des aktuellen Exports oder Differenz Prognose-Grundlast).
- Wenn `nextHourForecast < currentHourForecastCorrected × 0.5` (Wolkenfront):
  - `comfortBudget = Math.max(0, comfortBudget × 0.7)` (konservativ, blockiert neue Komfort-Aktivierungen).
- Logging: `[LOOKAHEAD] Stunde+1=Xw, Faktor=Y, Komfort-Budget Z→W`.

**d) Endgültiges Komfort-Budget:**
```
comfortBudget = max(0, gridExport - dynamicBaseloadBuffer + trendBonus + comfortLookaheadBonus)
```
Bestehender SOC-Hard-Lock (SOC < heating_min_battery_soc → comfortBudget = 0) bleibt vorrangig.

### 2. Parallel-Kapazitäts-Vorabberechnung & Logging (~Z. 1620, vor Phase 1)

Neue Berechnung **vor** den Phasen-Schleifen:
- Kandidaten ermitteln:
  - **Eco-Kandidaten:** Räume mit `current_temp < eco_temp - 0.3` UND `automation_enabled` UND keine Pause/Override.
  - **Komfort-Kandidaten:** Räume mit `current_temp ≥ eco_temp - 0.3` UND `current_temp < comfort_temp - 0.3` UND wie oben.
- Sortiert nach Priorität, kumulieren wie viele Räume mit ihrer `heatingPower` ins Eco- bzw. Komfort-Budget passen.
- Persistieren als `system_settings.parallel_heating_capacity` JSONB:
  ```json
  {
    "computed_at": "2026-04-26T...",
    "grid_export_w": 9800,
    "baseload_buffer_w": 450,
    "trend_w_per_5min": 1200,
    "trend_bonus_w": 600,
    "lookahead_bonus_w": 800,
    "eco_budget_w": 8200,
    "comfort_budget_w": 9750,
    "eco_candidates": [{"room_id":"...","name":"Wohnen","power_w":1200}, ...],
    "comfort_candidates": [...],
    "max_parallel_eco": 6,
    "max_parallel_comfort": 4,
    "planned_eco_room_ids": [...],
    "planned_comfort_room_ids": [...]
  }
  ```
- Konsolen-Log: `[PARALLEL-PLAN] Export 9800W, Puffer 450W, Trend +600W, Lookahead +800W → Eco-Budget 8200W (6 Räume parallel), Komfort-Budget 9750W (4 Räume parallel)`.

### 3. Phasen-Schleifen unverändert lassen
Die bestehende sequenzielle Vergabe in Phase 1 / 2 ist korrekt — sie verbraucht jetzt nur ein **größeres Budget**, sodass automatisch mehr Räume parallel allokiert werden. Keine Logik-Änderung an den Schleifen selbst.

### 4. Frontend-Hook & UI-Tooltip

**Neuer Hook `src/hooks/useParallelHeatingCapacity.ts`:**
- Liest `system_settings.parallel_heating_capacity` alle 60 s.
- Liefert `{ ecoBudgetW, comfortBudgetW, maxParallelEco, maxParallelComfort, plannedEco, plannedComfort, trend, lookahead, baseloadBuffer }`.

**`RoomStatusTable.tsx` — Header-Erweiterung (~Z. 131):**
Bestehende Zeile *„Aktuell heizen: N Räume · X W"* erhält rechts daneben einen Info-Icon-Tooltip:
> **Parallele Kapazität**
> Komfort-Budget: 9.75 kW (für 4 Räume)
> Eco-Budget: 8.20 kW (für 6 Räume)
> ─────
> Gridexport: 9.80 kW
> Baseload-Puffer: −0.45 kW
> PV-Trend (5 min): +1.20 kW → +0.60 kW Bonus
> Lookahead Stunde+1: +0.80 kW
> ─────
> Geplant Komfort: Wohnen, Bad, Schlafen, Küche

Bei `totalHeatingPower < comfortBudget − 1000W` zusätzlich kleines Badge: **„+N Räume möglich"** (animiert, dezent).

### 5. Dokumentation

- **Neu** `mem://features/heating/parallel-heating-allocation`: Beschreibt Baseload-Puffer, symmetrischen Trend-Faktor, Lookahead-Bonus, Persistierung in `system_settings`.
- **Update** `mem://arch/pv-automation-budget-logic-v2`:
  - Komfort-Budget = `gridExport − dynamicBaseloadBuffer + trendBonus(symmetrisch) + lookaheadBonus`.
  - Trend-Faktor 0.5× symmetrisch, kein Threshold.
  - Lookahead nur Komfort, nicht Eco.
- **Update** `mem://index.md` Core: „Komfort-Budget ist gridExport minus Baseload-Puffer plus moderater Trend-/Lookahead-Bonus — keine Batterie."

### 6. Edge-Function deployen
Nach Code-Änderung: `pv-automation` deployen, ein Heartbeat triggern, Logs prüfen (`[PARALLEL-PLAN]`, `[BASELOAD-BUFFER]`, `[LOOKAHEAD]`).

## Erwartetes Verhalten bei 9.8 kW Export

- Baseload-Stddev ~300 W → Puffer 450 W.
- Trend +1.2 kW/5min → Bonus +600 W.
- Prognose nächste Stunde 8 kW → Lookahead-Bonus +800 W.
- **Komfort-Budget = 9800 − 450 + 600 + 800 = 10.75 kW**.
- 4–5 Räume gehen **gleichzeitig** auf Komfort, statt einer nach dem anderen.
- Tooltip im UI zeigt transparent, warum diese Allokation gewählt wurde.

## Schutzmechanismen bleiben unverändert
- SOC-Hard-Lock (SOC < 80% → comfortBudget = 0).
- Hysterese (gridExport < threshold_on blockiert Neu-Starts).
- Eco vor Komfort innerhalb desselben Raums (Phase 1 sequenziell für Räume die noch unter Eco sind).
- Manual Override, Rotation, min_room_pause_minutes.