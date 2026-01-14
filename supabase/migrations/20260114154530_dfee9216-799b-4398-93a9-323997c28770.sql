-- Repair NULL duration_minutes for heating_stop events from TODAY (2026-01-14)
-- Uses the same logic: calculate from last heating_start, with energy estimate

UPDATE room_heating_logs hs
SET 
  duration_minutes = GREATEST(2, ROUND(
    EXTRACT(EPOCH FROM (hs.timestamp - (
      SELECT MAX(start.timestamp)
      FROM room_heating_logs start
      WHERE start.room_id = hs.room_id
      AND start.event_type = 'heating_start'
      AND start.timestamp < hs.timestamp
    ))) / 60
  )),
  energy_estimate_wh = GREATEST(2, ROUND(
    EXTRACT(EPOCH FROM (hs.timestamp - (
      SELECT MAX(start.timestamp)
      FROM room_heating_logs start
      WHERE start.room_id = hs.room_id
      AND start.event_type = 'heating_start'
      AND start.timestamp < hs.timestamp
    ))) / 60
  )) * COALESCE(
    (SELECT heating_power_w FROM rooms WHERE id = hs.room_id), 
    700
  ) / 60
WHERE hs.event_type = 'heating_stop'
AND hs.duration_minutes IS NULL
AND hs.timestamp >= '2026-01-14T00:00:00';