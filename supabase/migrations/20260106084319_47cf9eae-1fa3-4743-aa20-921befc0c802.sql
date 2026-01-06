-- Add automation fields to rooms table
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS automation_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_auto_change timestamp with time zone DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.rooms.automation_enabled IS 'Whether automatic temperature adjustments are enabled for this room';
COMMENT ON COLUMN public.rooms.last_auto_change IS 'Timestamp of last automatic temperature change';