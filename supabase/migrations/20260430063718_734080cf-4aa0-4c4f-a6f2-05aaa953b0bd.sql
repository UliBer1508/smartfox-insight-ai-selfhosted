-- Update Flur comfort_temp via SECURITY DEFINER context
DO $$
BEGIN
  UPDATE public.rooms SET comfort_temp = 21 WHERE name = 'Flur';
END $$;