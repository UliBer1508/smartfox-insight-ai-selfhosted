
-- Auto-capture temperature samples on every rooms update.
-- This is robust against the writer (cloud edge function vs. local collector vs. future clients).
CREATE OR REPLACE FUNCTION public.capture_room_temperature_sample()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv_power INTEGER;
BEGIN
  -- Only act when thermostat data actually changed
  IF NEW.current_temp IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.current_temp IS NOT DISTINCT FROM NEW.current_temp
     AND OLD.is_heating IS NOT DISTINCT FROM NEW.is_heating
     AND OLD.last_thermostat_sync IS NOT DISTINCT FROM NEW.last_thermostat_sync THEN
    RETURN NEW;
  END IF;

  -- Pick the most recent PV power (W) from energy_readings (last 10 min)
  SELECT ROUND(pv_power)::int INTO v_pv_power
  FROM public.energy_readings
  WHERE timestamp > now() - interval '10 minutes'
  ORDER BY timestamp DESC
  LIMIT 1;

  INSERT INTO public.room_temperature_samples (room_id, temperature, is_heating, pv_power_w, timestamp)
  VALUES (NEW.id, NEW.current_temp, COALESCE(NEW.is_heating, false), v_pv_power, COALESCE(NEW.last_thermostat_sync, now()));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_room_temperature_sample ON public.rooms;
CREATE TRIGGER trg_capture_room_temperature_sample
AFTER UPDATE OF current_temp, is_heating, last_thermostat_sync ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.capture_room_temperature_sample();
