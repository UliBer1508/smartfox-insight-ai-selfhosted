-- Trigger anpassen: service_role darf alle Spalten ändern (für Wartung & interne Tools)
CREATE OR REPLACE FUNCTION public.protect_rooms_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_role text;
BEGIN
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );

  -- service_role und postgres dürfen alles ändern
  IF caller_role IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Authenticated users dürfen alles ändern
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Anon: sensible Spalten zurücksetzen
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
  RETURN NEW;
END;
$function$;