-- ============================================================
-- Week 1 Migration v3: AI Foundation (data_type fixed)
-- ============================================================

-- 1) room_kpi_15min
CREATE TABLE IF NOT EXISTS public.room_kpi_15min (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL,
  bucket_start TIMESTAMP WITH TIME ZONE NOT NULL,
  grid_import_wh NUMERIC DEFAULT 0,
  pv_used_wh NUMERIC DEFAULT 0,
  heating_minutes INTEGER DEFAULT 1,
  temp_start NUMERIC DEFAULT NULL,
  temp_end NUMERIC DEFAULT NULL,
  target_temp NUMERIC DEFAULT NULL,
  target_reached BOOLEAN DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (room_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_room_kpi_15min_room_id_bucket ON public.room_kpi_15min(room_id, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_room_kpi_15min_bucket ON public.room_kpi_15min(bucket_start DESC);
ALTER TABLE public.room_kpi_15min ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access on room_kpi_15min"
  ON public.room_kpi_15min FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Anon collector can read room_kpi_15min"
  ON public.room_kpi_15min FOR SELECT
  TO anon USING (true);

-- 2) heating_recommendations erweitern
ALTER TABLE public.heating_recommendations
  ADD COLUMN IF NOT EXISTS ai_source TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS priority_rank INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reasoning TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS valid_for_date DATE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_heating_recommendations_ai_source_date ON public.heating_recommendations(ai_source, valid_for_date DESC);

-- 3) ai_parameter_decisions erweitern
ALTER TABLE public.ai_parameter_decisions
  ADD COLUMN IF NOT EXISTS auto_applied BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 4) Validierungsfunktion
CREATE OR REPLACE FUNCTION public.validate_ai_auto_apply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  caller_role TEXT;
  wl RECORD;
  v NUMERIC;
  v_str TEXT;
  t_val time without time zone;
  minutes_val NUMERIC;
BEGIN
  caller_role := COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'postgres'
  );
  IF caller_role NOT IN ('service_role', 'postgres', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE key = 'ai_auto_mode_enabled'
      AND (value->>'enabled')::boolean = true
  ) THEN
    RAISE EXCEPTION 'AI auto-apply disabled via kill-switch';
  END IF;

  FOR wl IN
    SELECT parameter_key, min_value, max_value, allowed_values, data_type
    FROM public.ai_parameter_whitelist
    WHERE autonomy_level = 'auto'
      AND enabled = true
      AND storage_table = 'heating_settings'
  LOOP
    v_str := row_to_json(NEW) ->> wl.parameter_key;
    IF v_str IS NULL THEN
      CONTINUE;
    END IF;

    IF wl.data_type = 'text' AND wl.parameter_key LIKE '%_time' THEN
      t_val := v_str::time without time zone;
      minutes_val := EXTRACT(HOUR FROM t_val)::numeric * 60 + EXTRACT(MINUTE FROM t_val)::numeric;
      IF wl.min_value IS NOT NULL AND minutes_val < wl.min_value THEN
        RAISE EXCEPTION 'Time value % for % below whitelist min (minutes since 00:00): %', v_str, wl.parameter_key, wl.min_value;
      END IF;
      IF wl.max_value IS NOT NULL AND minutes_val > wl.max_value THEN
        RAISE EXCEPTION 'Time value % for % above whitelist max (minutes since 00:00): %', v_str, wl.parameter_key, wl.max_value;
      END IF;
      CONTINUE;
    END IF;

    v := NULL;
    BEGIN
      v := v_str::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      v := NULL;
    END;

    IF v IS NOT NULL THEN
      IF wl.min_value IS NOT NULL AND v < wl.min_value THEN
        RAISE EXCEPTION 'Value % for % below whitelist min %', v, wl.parameter_key, wl.min_value;
      END IF;
      IF wl.max_value IS NOT NULL AND v > wl.max_value THEN
        RAISE EXCEPTION 'Value % for % above whitelist max %', v, wl.parameter_key, wl.max_value;
      END IF;
      IF wl.allowed_values IS NOT NULL THEN
        IF NOT (jsonb_array_length(wl.allowed_values) = 1 AND wl.allowed_values->>0 IS NULL) THEN
          IF NOT (wl.allowed_values ? v::TEXT) THEN
            RAISE EXCEPTION 'Value % for % not in whitelist allowed_values', v, wl.parameter_key;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_ai_auto_apply ON public.heating_settings;
CREATE TRIGGER tr_validate_ai_auto_apply
  BEFORE UPDATE ON public.heating_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ai_auto_apply();

-- 5) system_settings Seed
INSERT INTO public.system_settings (key, value) VALUES
  ('tuya_cloud_status',    '{"active": false, "reason": "Lokaler Service aktiv", "since": "2025-01"}'::jsonb),
  ('ai_auto_mode_enabled',  '{"enabled": true}'::jsonb),
  ('daily_planner_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 6) Pilot-Parameter auf auto setzen
UPDATE public.ai_parameter_whitelist
SET autonomy_level = 'auto'
WHERE parameter_key IN ('pv_surplus_threshold_on', 'pv_surplus_threshold_off', 'night_start_time')
  AND storage_table = 'heating_settings';

INSERT INTO public.ai_parameter_whitelist (
  parameter_key, scope, storage_table, storage_column, data_type,
  min_value, max_value, allowed_values, autonomy_level, enabled, description
) VALUES
  ('pv_surplus_threshold_on',  'global', 'heating_settings', 'pv_surplus_threshold_on',  'integer', 300, 800, null, 'auto', true, 'PV-Überschuss Schwellwert EIN'),
  ('pv_surplus_threshold_off', 'global', 'heating_settings', 'pv_surplus_threshold_off', 'integer', 100, 400, null, 'auto', true, 'PV-Überschuss Schwellwert AUS'),
  ('night_start_time',         'global', 'heating_settings', 'night_start_time',         'text',    1260, 1380, null, 'auto', true, 'Nachtmodus Startzeit (21:00-23:00, Minuten seit 00:00)')
ON CONFLICT (parameter_key, scope) DO UPDATE SET
  autonomy_level = EXCLUDED.autonomy_level,
  enabled = EXCLUDED.enabled,
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type;
