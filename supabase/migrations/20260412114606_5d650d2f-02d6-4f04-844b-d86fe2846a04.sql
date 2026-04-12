
-- 1. Protect sensitive columns on rooms from anonymous updates
CREATE OR REPLACE FUNCTION public.protect_rooms_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check if current user is anon (not authenticated)
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'anon' 
     OR auth.uid() IS NULL THEN
    -- Prevent changes to sensitive columns by resetting them to OLD values
    NEW.local_key := OLD.local_key;
    NEW.tuya_device_id := OLD.tuya_device_id;
    NEW.thermostat_ip := OLD.thermostat_ip;
    NEW.thermostat_local_ip := OLD.thermostat_local_ip;
    NEW.name := OLD.name;
    NEW.comfort_temp := OLD.comfort_temp;
    NEW.eco_temp := OLD.eco_temp;
    NEW.night_temp := OLD.night_temp;
    NEW.priority := OLD.priority;
    NEW.floor_area_m2 := OLD.floor_area_m2;
    NEW.orientation := OLD.orientation;
    NEW.heating_power_w := OLD.heating_power_w;
    NEW.automation_enabled := OLD.automation_enabled;
    NEW.pv_boost_max_temp := OLD.pv_boost_max_temp;
    NEW.solar_limit_temp := OLD.solar_limit_temp;
    NEW.solar_heating_temp := OLD.solar_heating_temp;
    NEW.has_solar_gain := OLD.has_solar_gain;
    NEW.pv_auto_enabled := OLD.pv_auto_enabled;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_rooms_sensitive_columns_trigger
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.protect_rooms_sensitive_columns();

-- 2. Fix system_settings policies - remove public read, restrict to authenticated
DROP POLICY IF EXISTS "System settings are publicly readable" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated users can insert system settings" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated users can update system settings" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated users can read system settings" ON public.system_settings;

CREATE POLICY "Authenticated users can read system settings"
ON public.system_settings FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert system settings"
ON public.system_settings FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update system settings"
ON public.system_settings FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Recreate rooms_public view with SECURITY INVOKER
DROP VIEW IF EXISTS public.rooms_public;
CREATE VIEW public.rooms_public
WITH (security_invoker = true)
AS SELECT
  id, name, thermostat_type, orientation, has_solar_gain,
  floor_area_m2, comfort_temp, eco_temp, night_temp, priority,
  heating_power_w, current_temp, target_temp, is_heating,
  pv_auto_enabled, last_thermostat_sync, estimated_kwh_per_degree,
  last_heating_duration_min, avg_heating_cycles_per_day,
  pv_auto_active, pv_auto_last_change, automation_enabled,
  last_auto_change, calculated_power_w, power_calculation_confidence,
  power_samples, last_power_calculation, calculated_solar_gain_factor,
  solar_gain_confidence, solar_gain_samples, calculated_heat_loss_rate,
  last_solar_analysis, manual_override_until, solar_limit_temp,
  pv_boost_max_temp, solar_heating_temp, created_at, updated_at,
  heating_paused_reason, last_heating_start, last_heating_end
FROM public.rooms;

-- Re-grant SELECT on the view for anon (collector needs it)
GRANT SELECT ON public.rooms_public TO anon;
GRANT SELECT ON public.rooms_public TO authenticated;

-- 4. Add auth check to cleanup_old_data
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  retention_raw INTEGER;
  retention_hourly INTEGER;
  caller_role text;
BEGIN
  -- Allow only service_role or pg_cron (no direct user calls)
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'postgres'
  );
  
  IF caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Unauthorized: cleanup_old_data can only be called by service_role or pg_cron';
  END IF;

  SELECT 
    COALESCE(raw_data_retention_days, 7),
    COALESCE(hourly_retention_days, 90)
  INTO retention_raw, retention_hourly
  FROM data_retention_settings
  LIMIT 1;

  IF retention_raw IS NULL THEN retention_raw := 7; END IF;
  IF retention_hourly IS NULL THEN retention_hourly := 90; END IF;

  DELETE FROM energy_readings 
  WHERE timestamp < NOW() - (retention_raw || ' days')::INTERVAL;

  DELETE FROM hourly_aggregates 
  WHERE hour_start < NOW() - (retention_hourly || ' days')::INTERVAL;

  DELETE FROM room_temperature_samples 
  WHERE timestamp < NOW() - INTERVAL '14 days';

  DELETE FROM room_heating_logs 
  WHERE timestamp < NOW() - INTERVAL '90 days';

  DELETE FROM consumer_logs 
  WHERE start_time < NOW() - INTERVAL '30 days';

  DELETE FROM solar_heating_events 
  WHERE timestamp < NOW() - INTERVAL '30 days';

  DELETE FROM room_recommendations 
  WHERE date < CURRENT_DATE - 7;

  DELETE FROM heating_recommendations 
  WHERE date < CURRENT_DATE - 7;

  DELETE FROM room_ml_features 
  WHERE date < CURRENT_DATE - 90;

  DELETE FROM learning_events 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  DELETE FROM api_errors 
  WHERE resolved_at IS NOT NULL 
    AND created_at < NOW() - INTERVAL '7 days';
  
  DELETE FROM api_errors 
  WHERE created_at < NOW() - INTERVAL '30 days';

  DELETE FROM pv_forecasts 
  WHERE date < CURRENT_DATE - 7;

  UPDATE data_retention_settings 
  SET last_cleanup_at = NOW(), updated_at = NOW();
END;
$function$;
