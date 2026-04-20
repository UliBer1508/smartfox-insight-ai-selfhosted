ALTER TABLE public.heating_settings
  ADD COLUMN IF NOT EXISTS heating_min_battery_soc INTEGER DEFAULT 80,
  ADD COLUMN IF NOT EXISTS heating_soc_gate_mode TEXT DEFAULT 'strict';