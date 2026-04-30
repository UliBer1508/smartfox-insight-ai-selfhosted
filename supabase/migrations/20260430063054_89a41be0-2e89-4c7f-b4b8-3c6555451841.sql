ALTER TABLE public.rooms DISABLE TRIGGER protect_rooms_sensitive_columns_trigger;

UPDATE public.rooms
SET automation_enabled = false,
    pv_auto_enabled = false,
    heating_paused_reason = 'Tuya Cloud-Subscription: Gerät nicht steuerbar (60001001)',
    updated_at = NOW()
WHERE name = 'Haustür';

ALTER TABLE public.rooms ENABLE TRIGGER protect_rooms_sensitive_columns_trigger;