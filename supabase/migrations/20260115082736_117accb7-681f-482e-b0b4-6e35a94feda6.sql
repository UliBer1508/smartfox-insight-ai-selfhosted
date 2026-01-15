-- RPC-Funktion für serverseitige Heizhistorie-Aggregation
CREATE OR REPLACE FUNCTION get_heating_history(days_back integer DEFAULT 7)
RETURNS TABLE (
  local_date date,
  room_id uuid,
  room_name text,
  cycles integer,
  total_minutes integer,
  total_energy_wh numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(l.timestamp AT TIME ZONE 'Europe/Berlin') as local_date,
    l.room_id,
    r.name as room_name,
    COUNT(*)::integer as cycles,
    COALESCE(SUM(l.duration_minutes), 0)::integer as total_minutes,
    COALESCE(SUM(l.energy_estimate_wh), 0)::numeric as total_energy_wh
  FROM room_heating_logs l
  JOIN rooms r ON r.id = l.room_id
  WHERE l.event_type = 'heating_stop'
    AND l.timestamp >= (CURRENT_DATE - days_back) AT TIME ZONE 'Europe/Berlin'
    AND l.duration_minutes > 0
    AND l.duration_minutes <= 240
  GROUP BY DATE(l.timestamp AT TIME ZONE 'Europe/Berlin'), l.room_id, r.name
  ORDER BY DATE(l.timestamp AT TIME ZONE 'Europe/Berlin') DESC, r.name;
END;
$$ LANGUAGE plpgsql;