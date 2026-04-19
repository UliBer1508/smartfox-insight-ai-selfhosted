ALTER TABLE public.heating_settings
  ADD COLUMN IF NOT EXISTS micro_budget_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS micro_budget_min_battery_soc integer DEFAULT 80,
  ADD COLUMN IF NOT EXISTS micro_heat_duration_min integer DEFAULT 5;