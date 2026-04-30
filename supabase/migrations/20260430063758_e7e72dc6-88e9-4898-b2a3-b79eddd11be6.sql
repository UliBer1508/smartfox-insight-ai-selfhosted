ALTER TABLE public.rooms DISABLE TRIGGER protect_rooms_sensitive_columns_trigger;
UPDATE public.rooms SET comfort_temp = 21 WHERE name = 'Flur';
ALTER TABLE public.rooms ENABLE TRIGGER protect_rooms_sensitive_columns_trigger;