-- Neue Spalte für Solar-Heiztemperatur
-- Diese Temperatur wird bei Sonneneinstrahlung verwendet, um die Heizung auszuschalten
ALTER TABLE rooms ADD COLUMN solar_heating_temp numeric DEFAULT NULL;

-- Bad Uli: Bei Solargewinn auf 18°C setzen (Heizung aus, wenn Raum > 18°C)
UPDATE rooms SET solar_heating_temp = 18 WHERE name = 'Bad Uli';