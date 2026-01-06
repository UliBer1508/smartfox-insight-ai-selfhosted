-- Add battery_power column to energy_readings table
ALTER TABLE public.energy_readings 
ADD COLUMN battery_power numeric NULL;