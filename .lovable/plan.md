
# ✅ PV-Boost 3 Bugs gefixt

## Änderungen in `pv-automation/index.ts`

1. **Boost-Schwelle**: `availableHeatingKwh > 10` → `> 3` (Zeile 682)
2. **Flag**: `room.pv_auto_enabled` → `room.automation_enabled` (Zeile 1322)
3. **Fallback boost_max**: Wenn `pv_boost_max_temp` fehlt oder <= comfort → `comfort + boostDelta`
4. **Boost-Gate**: `comfortTemp - 0.5` → `ecoTemp - 0.5` (Boost greift ab eco statt comfort)
5. **Surplus-Schwelle**: `gridExport > 1000` → `> 500` (passt zu `pv_surplus_threshold_on`)
