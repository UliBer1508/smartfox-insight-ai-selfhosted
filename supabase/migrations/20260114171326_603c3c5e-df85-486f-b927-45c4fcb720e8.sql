-- Add solar_limit_temp field to rooms table
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS solar_limit_temp numeric(4,2);
COMMENT ON COLUMN public.rooms.solar_limit_temp IS 'Maximale erlaubte Temperatur bei Solargewinn (ohne aktives Heizen)';