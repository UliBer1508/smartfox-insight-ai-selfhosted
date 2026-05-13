
-- Whitelist: which parameters AI may propose
CREATE TABLE public.ai_parameter_whitelist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','room')),
  storage_table text NOT NULL,
  storage_column text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('number','integer','boolean','text')),
  min_value numeric,
  max_value numeric,
  allowed_values jsonb,
  autonomy_level text NOT NULL DEFAULT 'shadow' CHECK (autonomy_level IN ('shadow','suggest','auto')),
  enabled boolean NOT NULL DEFAULT true,
  description text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parameter_key, scope)
);

ALTER TABLE public.ai_parameter_whitelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
ON public.ai_parameter_whitelist FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_ai_parameter_whitelist_updated_at
BEFORE UPDATE ON public.ai_parameter_whitelist
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Decision log
CREATE TABLE public.ai_parameter_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  parameter_scope text NOT NULL CHECK (parameter_scope IN ('global','room')),
  room_id uuid,
  parameter_key text NOT NULL,
  current_value text,
  proposed_value text NOT NULL,
  reasoning text,
  confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_outcome jsonb DEFAULT '{}'::jsonb,
  decision_mode text NOT NULL DEFAULT 'shadow' CHECK (decision_mode IN ('shadow','applied','rejected')),
  applied_at timestamptz,
  applied_by text,
  outcome_evaluated_at timestamptz,
  actual_outcome jsonb,
  outcome_score numeric
);

CREATE INDEX idx_ai_decisions_created ON public.ai_parameter_decisions (created_at DESC);
CREATE INDEX idx_ai_decisions_param ON public.ai_parameter_decisions (parameter_key, created_at DESC);
CREATE INDEX idx_ai_decisions_unevaluated ON public.ai_parameter_decisions (created_at) WHERE outcome_evaluated_at IS NULL;

ALTER TABLE public.ai_parameter_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
ON public.ai_parameter_decisions FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can write decisions"
ON public.ai_parameter_decisions FOR INSERT TO anon
WITH CHECK (true);

-- Seed whitelist
INSERT INTO public.ai_parameter_whitelist
(parameter_key, scope, storage_table, storage_column, data_type, min_value, max_value, allowed_values, description) VALUES
('comfort_saturation_override_enabled','global','system_settings','comfort_saturation_override','boolean',NULL,NULL,'[true,false]'::jsonb,'Battery-Full-Override für Komfort-Sättigung aktiv'),
('comfort_override_soc_min','global','system_settings','comfort_override_soc_min','integer',80,100,NULL,'SOC-Schwelle (%) ab der Override greift'),
('comfort_override_grid_export_min','global','system_settings','comfort_override_grid_export_min','integer',1000,8000,NULL,'Mindest-Netzeinspeisung (W) für Override'),
('comfort_override_forecast_min_kwh','global','system_settings','comfort_override_forecast_min_kwh','integer',2,30,NULL,'Mindest-Tagesprognose-Rest (kWh) für Override'),
('parallel_heating_capacity','global','system_settings','parallel_heating_capacity','integer',1,12,NULL,'Maximale Anzahl parallel heizender Räume'),
('pattern_recall_strength','global','heating_settings','pattern_recall_strength','integer',0,100,NULL,'Gewichtung historischer Muster (0-100)'),
('heating_min_battery_soc','global','heating_settings','heating_min_battery_soc','integer',30,90,NULL,'Hartes SOC-Gate für Heizung (%)'),
('night_heating_mode','global','heating_settings','night_heating_mode','text',NULL,NULL,'["frost_only","maintain"]'::jsonb,'Nacht-Heizmodus'),
('pv_boost_max_temp','room','rooms','pv_boost_max_temp','number',19,26,NULL,'Hardcap für PV-Boost pro Raum (°C)'),
('eco_temp','room','rooms','eco_temp','number',16,21,NULL,'Eco-Solltemperatur pro Raum (°C)'),
('comfort_temp','room','rooms','comfort_temp','number',18,24,NULL,'Komfort-Solltemperatur pro Raum (°C)');

CREATE TRIGGER trg_ai_decisions_validate_outcome BEFORE INSERT OR UPDATE ON public.ai_parameter_decisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
