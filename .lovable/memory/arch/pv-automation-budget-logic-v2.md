---
name: PV-Automation Budget Logic v2
description: Eco vs Komfort-Budget, Mikro-Budget, Prognose-Bonus, Batterie-Reserve, PV-Trend, tolerante Deaktivierung
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
- **Batterie-Puffer** (`battery_buffer_enabled`, default true) — gestuft nach `socAboveReserve = batterySoc - battery_reserve_for_night_soc`:
  - Δ ≥ 35 → 100% von `battery_buffer_bonus_w` (default 500W)
  - Δ ≥ 25 → 60%
  - Δ > 20 → 30%
  - Doppel-Gate: nur wenn `remainingPvForHeatingWh ≥ totalEcoEnergyNeededWh` UND `pvTrend ≥ -300W`
- **PV-Trend Bonus**: bei `pvTrend > +500W` (5-Min-Vergleich) → +300W (automatisch, nicht konfigurierbar)

**Komfort-Budget** (`comfortBudget`): IMMER strikt — nur echter `gridExport`, niemals Batterie, niemals Prognose-/Trend-/Reserve-Bonus.

**Batterie-Reserve für Nachverbrauch** (`battery_reserve_for_night_soc`, default 60%):
- Schützt SOC für Abend-/Nachtverbrauch
- Mikro-Budget Untergrenze wird dynamisch erhöht: `microMinSoc = max(micro_budget_min_battery_soc, reserve + 20)`
- Tabelle `battery_daily_tracking` (date unique) speichert: `soc_at_heating_start` (~09:00), `soc_at_heating_end` (17–19 Uhr), `soc_at_morning`, `min_soc_during_night`, `night_consumption_kwh`, `heating_battery_used_kwh`
- Edge Function `validate-battery-reserve` läuft täglich nach 09:00, schreibt `system_settings.battery_reserve_validation` mit Status + Empfehlung (`ok` / `increase_reserve_to_X` / `decrease_reserve_to_X`)

**Mikro-Budget Modus mit Soft-Rotation** (`micro_budget_enabled`, default true):
- Trigger: `0 < availableBudget < minRoomPower` UND `batterySoc >= microMinSoc` (dynamisch, siehe oben)
- Wählt 1 Raum nach Score: Priorität (1-12) × 100 + Defizit×10 + Pause-Min
- Aktivierung: `target_temp = eco_temp` + `system_settings.last_micro_rotation_at` mit `{ts, room_id, ended:false}`
- **Soft-Rotation Beendigung**: Nach `micro_heat_duration_min` (default 5) wird der aktive Mikro-Raum aktiv beendet → `target_temp = night_temp`, `ended:true`, `ended_at`
- **Cooldown** (`room_rotation_minutes`, default 30): läuft erst ab `ended_at`, nicht ab Aktivierung. Kein neuer Raum solange `ended === false`.
- Manual Override blockiert sowohl Aktivierung als auch Soft-Beendigung.

**Tolerante Deaktivierung** (`tolerant_deactivation_enabled`, default true):
- Greift NUR in Phase-1-Eco-Loop, nur für **bereits heizende Räume** bei kurzem Budget-Einbruch
- Doppel-Gate: `pvSufficientForEco === true` UND `pvTrend ≥ -200W`
- Overshoot-Limit: `overshoot ≤ max(300W, heatingPower × 0.4)` — verhindert unbegrenztes Stacking
- Selbstbegrenzend (sequentiell pro Raum, max ~3 × 300W Stack)
- Bei Sonnenuntergang/echtem PV-Einbruch (Trend < -200W) → harter Cutoff wie ohne Toleranz
- Tuya-Quota-Schutz: spart pro toleriertem Raum 2 Tuya-Calls (Deaktivierung + spätere Reaktivierung) bei wechselhaftem Wetter
- Log-Marker: `[TOLERANT-DEACTIVATION]` pro Raum, `[TUYA-QUOTA-RUN]` als Run-Counter
