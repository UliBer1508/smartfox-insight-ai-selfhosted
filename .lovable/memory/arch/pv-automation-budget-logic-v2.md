---
name: PV-Automation Budget Logic v2
description: Eco vs Komfort-Budget, Mikro-Budget mit Soft-Rotation, Prognose-Bonus
type: feature
---

Das Heizbudget der `pv-automation` arbeitet mit zwei separaten Budgets und mehreren Boost-Mechanismen:

**Eco-Budget** (`availableBudget`):
- Basis: `gridExport + currentlyHeatingPower + dynamicTolerance`
- Batterie-Korrekturen: bei Entladung Reduktion, bei niedrigem SOC (<80%) Ladereserve abziehen
- **Prognose-Bonus** (gestuft, nur Eco, nur tagsüber ≥9 Uhr):
  - PV-Rest ≥ 3× Eco-Bedarf + SOC ≥ 50% → +1500W
  - PV-Rest ≥ 2× Eco-Bedarf + SOC ≥ 60% → +800W
  - PV-Rest ≥ 1.5× Eco-Bedarf + SOC ≥ 70% → +400W

**Komfort-Budget** (`comfortBudget`): IMMER strikt — nur echter `gridExport`, niemals Batterie, niemals Prognose-Bonus.

**Mikro-Budget Modus mit Soft-Rotation** (`micro_budget_enabled`, default true):
- Trigger: `0 < availableBudget < minRoomPower` UND `batterySoc >= micro_budget_min_battery_soc` (default 80%)
- Wählt 1 Raum nach Score: Priorität (1-12) × 100 + Defizit×10 + Pause-Min
- Aktivierung: `target_temp = eco_temp` + `system_settings.last_micro_rotation_at` mit `{ts, room_id, ended:false}`
- **Soft-Rotation Beendigung**: Nach `micro_heat_duration_min` (default 5) wird der aktive Mikro-Raum aktiv beendet → `target_temp = night_temp`, `ended:true`, `ended_at`
- **Cooldown** (`room_rotation_minutes`, default 30): läuft erst ab `ended_at`, nicht ab Aktivierung. Kein neuer Raum solange `ended === false`.
- Manual Override blockiert sowohl Aktivierung als auch Soft-Beendigung.
