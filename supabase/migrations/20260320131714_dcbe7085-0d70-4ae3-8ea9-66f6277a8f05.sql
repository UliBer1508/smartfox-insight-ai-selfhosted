-- Fix function search_path for remaining functions
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_learned_policy_hour()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.hour_of_day < 0 OR NEW.hour_of_day > 23 THEN
    RAISE EXCEPTION 'hour_of_day must be between 0 and 23';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_heating_history(days_back integer DEFAULT 7)
RETURNS TABLE(local_date date, room_id uuid, room_name text, cycles integer, total_minutes integer, total_energy_wh numeric)
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH stop_events AS (
    SELECT 
      l.id,
      l.room_id,
      l.timestamp,
      l.duration_minutes,
      l.energy_estimate_wh,
      l.event_type,
      r.name as room_name,
      COALESCE(r.calculated_power_w, r.heating_power_w, 
        CASE WHEN r.floor_area_m2 IS NOT NULL THEN r.floor_area_m2 * 60 ELSE 800 END
      ) as room_power_w
    FROM room_heating_logs l
    JOIN rooms r ON r.id = l.room_id
    WHERE l.event_type IN ('heating_stop', 'solar_limit_stop')
      AND l.timestamp >= (CURRENT_DATE - days_back) AT TIME ZONE 'Europe/Berlin'
  ),
  events_with_energy AS (
    SELECT 
      se.id,
      se.room_id,
      se.room_name,
      se.timestamp,
      COALESCE(se.duration_minutes, 
        CASE 
          WHEN se.event_type = 'solar_limit_stop' THEN
            GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
              se.timestamp - COALESCE(
                (SELECT MAX(l2.timestamp) 
                 FROM room_heating_logs l2 
                 WHERE l2.room_id = se.room_id 
                   AND l2.event_type = 'solar_limit_start'
                   AND l2.timestamp < se.timestamp
                   AND l2.timestamp > se.timestamp - INTERVAL '4 hours'),
                se.timestamp - INTERVAL '2 minutes'
              )
            )) / 60))::integer
          ELSE 0
        END
      ) as effective_duration_min,
      COALESCE(se.energy_estimate_wh,
        CASE 
          WHEN se.duration_minutes IS NOT NULL THEN
            ROUND((se.room_power_w * se.duration_minutes / 60.0))
          WHEN se.event_type = 'solar_limit_stop' THEN
            ROUND((se.room_power_w * GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
              se.timestamp - COALESCE(
                (SELECT MAX(l2.timestamp) 
                 FROM room_heating_logs l2 
                 WHERE l2.room_id = se.room_id 
                   AND l2.event_type = 'solar_limit_start'
                   AND l2.timestamp < se.timestamp
                   AND l2.timestamp > se.timestamp - INTERVAL '4 hours'),
                se.timestamp - INTERVAL '2 minutes'
              )
            )) / 60)) / 60.0))
          ELSE 0
        END
      ) as effective_energy_wh
    FROM stop_events se
  )
  SELECT 
    DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin') as local_date,
    ewe.room_id,
    ewe.room_name,
    COUNT(*)::integer as cycles,
    COALESCE(SUM(ewe.effective_duration_min), 0)::integer as total_minutes,
    COALESCE(SUM(ewe.effective_energy_wh), 0)::numeric as total_energy_wh
  FROM events_with_energy ewe
  WHERE ewe.effective_duration_min > 0 
    AND ewe.effective_duration_min <= 240
  GROUP BY DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin'), ewe.room_id, ewe.room_name
  ORDER BY DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin') DESC, ewe.room_name;
END;
$function$;