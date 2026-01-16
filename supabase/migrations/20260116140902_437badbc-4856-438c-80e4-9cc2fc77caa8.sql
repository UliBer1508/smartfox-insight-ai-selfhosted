
-- Improved get_heating_history function that includes solar_limit_stop events
-- and calculates energy retroactively for events with NULL energy_estimate_wh
CREATE OR REPLACE FUNCTION public.get_heating_history(days_back integer DEFAULT 7)
 RETURNS TABLE(local_date date, room_id uuid, room_name text, cycles integer, total_minutes integer, total_energy_wh numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH stop_events AS (
    -- Get all stop events (both heating_stop and solar_limit_stop)
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
      -- Use existing duration if available, otherwise estimate based on previous start event
      COALESCE(se.duration_minutes, 
        CASE 
          WHEN se.event_type = 'solar_limit_stop' THEN
            -- For solar_limit_stop without duration, look for the matching start event
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
      -- Calculate energy if not present
      COALESCE(se.energy_estimate_wh,
        CASE 
          WHEN se.duration_minutes IS NOT NULL THEN
            ROUND((se.room_power_w * se.duration_minutes / 60.0))
          WHEN se.event_type = 'solar_limit_stop' THEN
            -- Estimate based on room power and calculated duration
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

-- Backfill existing solar_limit_stop events with estimated duration and energy
UPDATE room_heating_logs AS l
SET 
  duration_minutes = GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
    l.timestamp - COALESCE(
      (SELECT MAX(l2.timestamp) 
       FROM room_heating_logs l2 
       WHERE l2.room_id = l.room_id 
         AND l2.event_type = 'solar_limit_start'
         AND l2.timestamp < l.timestamp
         AND l2.timestamp > l.timestamp - INTERVAL '4 hours'),
      l.timestamp - INTERVAL '2 minutes'
    )
  )) / 60))::integer,
  energy_estimate_wh = ROUND((
    COALESCE(r.calculated_power_w, r.heating_power_w, 
      CASE WHEN r.floor_area_m2 IS NOT NULL THEN r.floor_area_m2 * 60 ELSE 800 END
    ) * GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
      l.timestamp - COALESCE(
        (SELECT MAX(l2.timestamp) 
         FROM room_heating_logs l2 
         WHERE l2.room_id = l.room_id 
           AND l2.event_type = 'solar_limit_start'
           AND l2.timestamp < l.timestamp
           AND l2.timestamp > l.timestamp - INTERVAL '4 hours'),
        l.timestamp - INTERVAL '2 minutes'
      )
    )) / 60)) / 60.0
  ))
FROM rooms r
WHERE l.event_type = 'solar_limit_stop'
  AND l.duration_minutes IS NULL
  AND l.room_id = r.id;
