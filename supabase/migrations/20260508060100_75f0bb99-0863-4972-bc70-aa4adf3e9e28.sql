CREATE TABLE public.service_health (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name        text UNIQUE NOT NULL,
  last_sync           timestamptz,
  sync_count          integer DEFAULT 0,
  last_error_count    integer DEFAULT 0,
  devices_configured  integer DEFAULT 0,
  devices_ok          integer DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_health_name ON public.service_health(service_name);

ALTER TABLE public.service_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
  ON public.service_health
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Anon collector can read service health"
  ON public.service_health
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon collector can insert service health"
  ON public.service_health
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon collector can update service health"
  ON public.service_health
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_service_health_updated_at
  BEFORE UPDATE ON public.service_health
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.service_health IS 'Health-Check für lokale Services (Tuya-Thermostat v2.0, Fronius-Collector)';