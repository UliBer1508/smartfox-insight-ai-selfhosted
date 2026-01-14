-- 1. Setze Fläche für Wirtschaftsraum (falls NULL)
UPDATE rooms 
SET floor_area_m2 = 12 
WHERE name = 'Wirtschaftsraum' AND floor_area_m2 IS NULL;

-- 2. Repariere NULL-Einträge mit geschätzten Werten basierend auf Raum-Durchschnitt
WITH room_averages AS (
  SELECT 
    room_id,
    COALESCE(AVG(duration_minutes), 15) as avg_duration
  FROM room_heating_logs 
  WHERE event_type = 'heating_stop' 
    AND duration_minutes IS NOT NULL 
    AND duration_minutes > 0
  GROUP BY room_id
)
UPDATE room_heating_logs l
SET 
  duration_minutes = COALESCE(
    (SELECT avg_duration FROM room_averages ra WHERE ra.room_id = l.room_id),
    15
  ),
  energy_estimate_wh = ROUND(
    COALESCE(
      (SELECT avg_duration FROM room_averages ra WHERE ra.room_id = l.room_id),
      15
    ) * COALESCE(
      (SELECT COALESCE(calculated_power_w, heating_power_w, 700) FROM rooms r WHERE r.id = l.room_id),
      700
    ) / 60
  )
WHERE l.event_type = 'heating_stop'
  AND l.duration_minutes IS NULL;