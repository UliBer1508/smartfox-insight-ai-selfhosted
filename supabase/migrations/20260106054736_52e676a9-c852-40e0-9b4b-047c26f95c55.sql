-- Add hotwater configuration columns to heating_settings
ALTER TABLE public.heating_settings
ADD COLUMN IF NOT EXISTS hotwater_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS hotwater_power_w integer DEFAULT 2800,
ADD COLUMN IF NOT EXISTS hotwater_schedule_start text DEFAULT '10:00',
ADD COLUMN IF NOT EXISTS hotwater_schedule_end text DEFAULT '16:00',
ADD COLUMN IF NOT EXISTS hotwater_min_surplus_w integer DEFAULT 1000;