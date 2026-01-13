-- Repair NULL duration_minutes for heating_stop events
-- Calculate duration from the last heating_start before each stop

UPDATE room_heating_logs hs
SET duration_minutes = GREATEST(2, ROUND(
  EXTRACT(EPOCH FROM (hs.timestamp - (
    SELECT MAX(start.timestamp)
    FROM room_heating_logs start
    WHERE start.room_id = hs.room_id
    AND start.event_type = 'heating_start'
    AND start.timestamp < hs.timestamp
  ))) / 60
))
WHERE hs.event_type = 'heating_stop'
AND hs.duration_minutes IS NULL;