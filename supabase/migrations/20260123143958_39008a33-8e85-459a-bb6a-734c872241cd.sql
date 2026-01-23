-- Update all south-facing rooms with solar_heating_temp and has_solar_gain
UPDATE rooms SET 
  has_solar_gain = true,
  solar_heating_temp = 17
WHERE name IN ('Wohnzimmer', 'Büro', 'Zimmer Luca', 'Zimmer Luis', 'Zimmer Uli');