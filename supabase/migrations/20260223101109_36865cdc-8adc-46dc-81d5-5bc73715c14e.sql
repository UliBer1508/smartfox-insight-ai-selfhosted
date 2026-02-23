
-- Fix 1: Update all "Authenticated users full access" RLS policies to verify auth.uid() IS NOT NULL
-- This ensures the JWT actually contains a valid user, not just the 'authenticated' role claim

-- Drop and recreate policies for all 18 tables
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'energy_readings', 'rooms', 'heating_settings', 'room_temperature_samples',
    'room_heating_logs', 'consumer_logs', 'learning_events', 'pv_forecasts',
    'weather_data', 'hourly_aggregates', 'daily_patterns', 'detected_patterns',
    'heating_recommendations', 'room_recommendations', 'room_ml_features',
    'data_retention_settings', 'energy_daily_costs', 'smartfox_settings',
    'api_errors', 'learned_policies', 'solar_heating_events', 'thermostat_commands'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    -- Drop existing permissive policy
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users full access" ON public.%I', tbl);
    -- Recreate with auth.uid() check
    EXECUTE format(
      'CREATE POLICY "Authenticated users full access" ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
      tbl
    );
  END LOOP;
END;
$$;

-- Fix 4: Add validation trigger for energy_readings to prevent data poisoning via anonymous insert
CREATE OR REPLACE FUNCTION public.validate_energy_reading()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate power_io range (-50000 to 50000 watts)
  IF NEW.power_io < -50000 OR NEW.power_io > 50000 THEN
    RAISE EXCEPTION 'power_io out of valid range (-50000 to 50000)';
  END IF;
  
  -- Validate energy values are non-negative
  IF NEW.energy_in < 0 OR NEW.energy_out < 0 THEN
    RAISE EXCEPTION 'energy_in and energy_out must be non-negative';
  END IF;
  
  -- Validate battery_soc range (0-100) if provided
  IF NEW.battery_soc IS NOT NULL AND (NEW.battery_soc < 0 OR NEW.battery_soc > 100) THEN
    RAISE EXCEPTION 'battery_soc must be between 0 and 100';
  END IF;
  
  -- Validate pv_power range if provided (0 to 50000)
  IF NEW.pv_power IS NOT NULL AND (NEW.pv_power < 0 OR NEW.pv_power > 50000) THEN
    RAISE EXCEPTION 'pv_power must be between 0 and 50000';
  END IF;
  
  -- Validate consumption range if provided
  IF NEW.consumption IS NOT NULL AND (NEW.consumption < 0 OR NEW.consumption > 100000) THEN
    RAISE EXCEPTION 'consumption must be between 0 and 100000';
  END IF;
  
  -- Reject future timestamps (more than 5 minutes ahead)
  IF NEW.timestamp > NOW() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'timestamp cannot be in the future';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_energy_reading_trigger
BEFORE INSERT OR UPDATE ON public.energy_readings
FOR EACH ROW
EXECUTE FUNCTION public.validate_energy_reading();
