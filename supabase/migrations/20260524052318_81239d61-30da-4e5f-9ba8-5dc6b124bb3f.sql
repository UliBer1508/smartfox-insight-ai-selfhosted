
-- Battery SOC suggestion system
CREATE TABLE IF NOT EXISTS public.battery_soc_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  old_value integer NOT NULL,
  new_value integer NOT NULL,
  pv_forecast_kwh numeric(6,2),
  avg_pv_7d_kwh numeric(6,2),
  soc_end_of_day integer,
  reason_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  decided_at timestamptz,
  decided_by text DEFAULT 'user'
);

CREATE INDEX IF NOT EXISTS idx_battery_soc_suggestions_status_created
  ON public.battery_soc_suggestions (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_battery_soc_suggestions_single_pending
  ON public.battery_soc_suggestions (status) WHERE status = 'pending';

ALTER TABLE public.battery_soc_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
  ON public.battery_soc_suggestions FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Anon can read suggestions"
  ON public.battery_soc_suggestions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Service inserts suggestions"
  ON public.battery_soc_suggestions FOR INSERT
  TO anon
  WITH CHECK (true);

ALTER TABLE public.heating_settings
  ADD COLUMN IF NOT EXISTS battery_soc_suggestion_enabled boolean NOT NULL DEFAULT true;
