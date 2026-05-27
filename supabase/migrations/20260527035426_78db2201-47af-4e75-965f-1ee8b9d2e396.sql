
CREATE TABLE public.energy_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valid_from date NOT NULL,
  valid_to date,
  electricity_price_cent numeric NOT NULL,
  feed_in_price_cent numeric NOT NULL,
  electricity_base_fee_year_eur numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT energy_price_history_source_check CHECK (source IN ('manual','salzburg_ag_auto','oemag_auto','initial'))
);

CREATE INDEX idx_energy_price_history_valid_from ON public.energy_price_history(valid_from DESC);

GRANT SELECT ON public.energy_price_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.energy_price_history TO authenticated;
GRANT ALL ON public.energy_price_history TO service_role;

ALTER TABLE public.energy_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read price history"
  ON public.energy_price_history FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated users full access price history"
  ON public.energy_price_history FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.close_previous_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.energy_price_history
  SET valid_to = NEW.valid_from - INTERVAL '1 day'
  WHERE id <> NEW.id
    AND valid_to IS NULL
    AND valid_from < NEW.valid_from;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_close_previous_price_history
AFTER INSERT ON public.energy_price_history
FOR EACH ROW EXECUTE FUNCTION public.close_previous_price_history();

INSERT INTO public.energy_price_history (
  valid_from, valid_to, electricity_price_cent, feed_in_price_cent,
  electricity_base_fee_year_eur, source, note
)
SELECT
  DATE '2026-01-01',
  NULL,
  COALESCE(electricity_price_kwh_cent, 20.28),
  COALESCE(feed_in_price_kwh_cent, 8.00),
  COALESCE(electricity_base_fee_year_eur, 36.00),
  'initial',
  'Initial-Import aus Heizungs-Einstellungen'
FROM public.heating_settings
LIMIT 1;

CREATE TABLE public.price_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  field text NOT NULL,
  old_value numeric,
  new_value numeric NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending',
  raw_excerpt text,
  decided_at timestamptz,
  decided_by text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_suggestions_source_check CHECK (source IN ('salzburg_ag','oemag')),
  CONSTRAINT price_suggestions_field_check CHECK (field IN ('electricity_price_cent','feed_in_price_cent','electricity_base_fee_year_eur')),
  CONSTRAINT price_suggestions_status_check CHECK (status IN ('pending','applied','dismissed'))
);

CREATE INDEX idx_price_suggestions_status ON public.price_suggestions(status, fetched_at DESC);

GRANT SELECT ON public.price_suggestions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_suggestions TO authenticated;
GRANT ALL ON public.price_suggestions TO service_role;

ALTER TABLE public.price_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read suggestions"
  ON public.price_suggestions FOR SELECT TO anon USING (true);

CREATE POLICY "Anon collector can insert suggestions"
  ON public.price_suggestions FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Authenticated users full access suggestions"
  ON public.price_suggestions FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
