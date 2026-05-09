ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS work_state text;
COMMENT ON COLUMN public.rooms.work_state IS 'Tuya DPS 5: "0"=nicht heizend, "1"=heizend';