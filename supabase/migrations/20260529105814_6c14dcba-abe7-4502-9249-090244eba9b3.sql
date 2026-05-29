CREATE OR REPLACE FUNCTION public.validate_ai_auto_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_role TEXT;
  wl RECORD;
  v NUMERIC;
  v_str TEXT;
  old_str TEXT;
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
    v_str := to_jsonb(NEW) ->> wl.parameter_key;
    IF v_str IS NULL THEN
      CONTINUE;
    END IF;

    -- Only validate parameters that are actually being changed by this update.
    -- Unchanged columns must not block legitimate partial updates.
    IF TG_OP = 'UPDATE' THEN
      old_str := to_jsonb(OLD) ->> wl.parameter_key;
      IF v_str IS NOT DISTINCT FROM old_str THEN
        CONTINUE;
      END IF;
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
$function$;