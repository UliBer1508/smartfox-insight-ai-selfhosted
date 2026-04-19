-- Settings erweitern
ALTER TABLE public.heating_settings
  ADD COLUMN IF NOT EXISTS battery_reserve_for_night_soc integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS battery_buffer_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS battery_buffer_bonus_w integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS tolerant_deactivation_enabled boolean DEFAULT true;

-- Tagestracking
CREATE TABLE IF NOT EXISTS public.battery_daily_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  soc_at_heating_start numeric,
  soc_at_heating_end numeric,
  soc_at_morning numeric,
  min_soc_during_night numeric,
  night_consumption_kwh numeric,
  heating_battery_used_kwh numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.battery_daily_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
  ON public.battery_daily_tracking
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Anon collector can insert tracking"
  ON public.battery_daily_tracking
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon collector can update tracking"
  ON public.battery_daily_tracking
  FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Anon collector can read tracking"
  ON public.battery_daily_tracking
  FOR SELECT TO anon
  USING (true);

CREATE TRIGGER update_battery_daily_tracking_updated_at
  BEFORE UPDATE ON public.battery_daily_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();