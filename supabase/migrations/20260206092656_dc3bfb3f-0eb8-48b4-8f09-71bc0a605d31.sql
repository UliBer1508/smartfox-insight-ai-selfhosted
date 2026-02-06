-- Leistungsbudget-Management: Neue Spalten für heating_settings
ALTER TABLE public.heating_settings 
ADD COLUMN IF NOT EXISTS power_budget_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS max_grid_heating_power_w INTEGER DEFAULT 2000,
ADD COLUMN IF NOT EXISTS power_budget_tolerance_w INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS room_rotation_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS min_room_pause_minutes INTEGER DEFAULT 15;

-- Tracking für Raum-Rotation
ALTER TABLE public.rooms 
ADD COLUMN IF NOT EXISTS last_heating_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_heating_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS heating_paused_reason TEXT;

COMMENT ON COLUMN public.heating_settings.power_budget_enabled IS 'Aktiviert Leistungsbudget-Management für sequenzielles Heizen';
COMMENT ON COLUMN public.heating_settings.max_grid_heating_power_w IS 'Max. Heizleistung bei Netzbezug (Nacht/bewölkt)';
COMMENT ON COLUMN public.heating_settings.power_budget_tolerance_w IS 'Erlaubter Netzbezug über PV-Leistung hinaus';
COMMENT ON COLUMN public.heating_settings.room_rotation_minutes IS 'Zeit bevor ein Raum pausiert wird für andere';
COMMENT ON COLUMN public.heating_settings.min_room_pause_minutes IS 'Mindest-Pause nach Rotation';
COMMENT ON COLUMN public.rooms.last_heating_start IS 'Wann aktuelle Heizphase begann';
COMMENT ON COLUMN public.rooms.last_heating_end IS 'Wann letzte Heizphase endete';
COMMENT ON COLUMN public.rooms.heating_paused_reason IS 'Grund für Pause: budget, rotation, target_reached';