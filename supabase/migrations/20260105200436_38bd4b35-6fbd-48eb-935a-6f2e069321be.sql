-- Add PV automation tracking columns to rooms table
ALTER TABLE public.rooms 
ADD COLUMN IF NOT EXISTS pv_auto_active boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS pv_auto_last_change timestamp with time zone;