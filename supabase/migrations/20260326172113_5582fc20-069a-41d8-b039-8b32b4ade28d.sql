
-- 1. Create view without sensitive columns
CREATE VIEW rooms_public AS
SELECT id, name, has_solar_gain, floor_area_m2, comfort_temp, eco_temp, 
       night_temp, priority, heating_power_w, created_at, updated_at,
       current_temp, target_temp, is_heating, pv_auto_enabled, 
       last_thermostat_sync, pv_auto_active, pv_auto_last_change,
       estimated_kwh_per_degree, last_heating_duration_min, 
       avg_heating_cycles_per_day, automation_enabled, last_auto_change,
       calculated_power_w, power_calculation_confidence, power_samples,
       last_power_calculation, calculated_solar_gain_factor, 
       solar_gain_confidence, solar_gain_samples, calculated_heat_loss_rate,
       last_solar_analysis, manual_override_until, solar_limit_temp,
       solar_heating_temp, last_heating_start, last_heating_end,
       pv_boost_max_temp, heating_paused_reason, thermostat_type, orientation
FROM rooms;

-- 2. Grant anon read access to the view
GRANT SELECT ON rooms_public TO anon;

-- 3. Remove the anonymous SELECT policy on rooms table
DROP POLICY IF EXISTS "Anon collector can read rooms" ON rooms;
