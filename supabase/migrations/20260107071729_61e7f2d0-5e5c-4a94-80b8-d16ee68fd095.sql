-- Add new fields to rooms table for calculated heating power
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS calculated_power_w NUMERIC;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS power_calculation_confidence NUMERIC DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS power_samples INTEGER DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS last_power_calculation TIMESTAMPTZ;

-- Add consumption tracking fields to room_heating_logs
ALTER TABLE public.room_heating_logs ADD COLUMN IF NOT EXISTS consumption_at_start_w INTEGER;
ALTER TABLE public.room_heating_logs ADD COLUMN IF NOT EXISTS consumption_during_avg_w INTEGER;