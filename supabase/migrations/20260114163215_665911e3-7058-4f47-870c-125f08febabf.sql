-- Bereinige fehlerhafte Heating-Logs mit unrealistischen Dauern (> 4 Stunden = 240 Minuten)
-- Diese entstanden durch einen Bug wo heating_stop Events keinen passenden Start fanden

-- Setze unrealistische Werte auf NULL statt zu löschen (Daten bleiben erhalten)
UPDATE room_heating_logs 
SET duration_minutes = NULL, energy_estimate_wh = NULL
WHERE event_type = 'heating_stop' 
  AND duration_minutes > 240;

-- Lösche verwaiste heating_start Events die älter als 24 Stunden sind
-- (Diese wurden nie mit einem Stop abgeschlossen)
DELETE FROM room_heating_logs 
WHERE event_type = 'heating_start' 
  AND timestamp < NOW() - INTERVAL '24 hours';