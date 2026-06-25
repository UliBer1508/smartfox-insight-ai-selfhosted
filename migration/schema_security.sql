-- =====================================================================
-- smartfox-insight-ai : ZUSATZSKRIPT
-- RLS aktivieren + Policies + GRANTs + Funktionen + Trigger
-- NACH dem Schema-Skript (Tabellen) im neuen Supabase-Projekt ausfuehren.
-- =====================================================================


-- ===== 1) FUNKTIONEN (14) =====

-- function: capture_room_temperature_sample
CREATE OR REPLACE FUNCTION public.capture_room_temperature_sample()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pv_power INTEGER;
BEGIN
  -- Only act when thermostat data actually changed
  IF NEW.current_temp IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.current_temp IS NOT DISTINCT FROM NEW.current_temp
     AND OLD.is_heating IS NOT DISTINCT FROM NEW.is_heating
     AND OLD.last_thermostat_sync IS NOT DISTINCT FROM NEW.last_thermostat_sync THEN
    RETURN NEW;
  END IF;

  -- Pick the most recent PV power (W) from energy_readings (last 10 min)
  SELECT ROUND(pv_power)::int INTO v_pv_power
  FROM public.energy_readings
  WHERE timestamp > now() - interval '10 minutes'
  ORDER BY timestamp DESC
  LIMIT 1;

  INSERT INTO public.room_temperature_samples (room_id, temperature, is_heating, pv_power_w, timestamp)
  VALUES (NEW.id, NEW.current_temp, COALESCE(NEW.is_heating, false), v_pv_power, COALESCE(NEW.last_thermostat_sync, now()));

  RETURN NEW;
END;
$function$;

-- function: cleanup_ai_parameter_decisions
CREATE OR REPLACE FUNCTION public.cleanup_ai_parameter_decisions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_role text;
  total_deleted integer := 0;
  affected integer;
  excess integer;
BEGIN
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'postgres'
  );
  IF caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Unauthorized: cleanup_ai_parameter_decisions can only be called by service_role or pg_cron';
  END IF;

  -- Retention by age
  DELETE FROM public.ai_parameter_decisions
  WHERE
    (applied_at IS NOT NULL AND created_at < now() - interval '30 days')
    OR (outcome_evaluated_at IS NOT NULL AND created_at < now() - interval '30 days')
    OR (applied_at IS NULL AND outcome_evaluated_at IS NULL AND created_at < now() - interval '7 days');
  GET DIAGNOSTICS affected = ROW_COUNT;
  total_deleted := total_deleted + affected;

  -- Hard cap: 500 rows
  SELECT GREATEST(COUNT(*)::int - 500, 0) INTO excess FROM public.ai_parameter_decisions;
  IF excess > 0 THEN
    DELETE FROM public.ai_parameter_decisions
    WHERE id IN (
      SELECT id FROM public.ai_parameter_decisions
      ORDER BY created_at ASC
      LIMIT excess
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total_deleted := total_deleted + affected;
  END IF;

  RETURN total_deleted;
END;
$function$;

-- function: cleanup_old_data
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  retention_raw INTEGER;
  retention_hourly INTEGER;
  caller_role text;
BEGIN
  -- Allow only service_role or pg_cron (no direct user calls)
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'postgres'
  );
  
  IF caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Unauthorized: cleanup_old_data can only be called by service_role or pg_cron';
  END IF;

  SELECT 
    COALESCE(raw_data_retention_days, 7),
    COALESCE(hourly_retention_days, 90)
  INTO retention_raw, retention_hourly
  FROM data_retention_settings
  LIMIT 1;

  IF retention_raw IS NULL THEN retention_raw := 7; END IF;
  IF retention_hourly IS NULL THEN retention_hourly := 90; END IF;

  DELETE FROM energy_readings 
  WHERE timestamp < NOW() - (retention_raw || ' days')::INTERVAL;

  DELETE FROM hourly_aggregates 
  WHERE hour_start < NOW() - (retention_hourly || ' days')::INTERVAL;

  DELETE FROM room_temperature_samples 
  WHERE timestamp < NOW() - INTERVAL '14 days';

  DELETE FROM room_heating_logs 
  WHERE timestamp < NOW() - INTERVAL '90 days';

  DELETE FROM consumer_logs 
  WHERE start_time < NOW() - INTERVAL '30 days';

  DELETE FROM solar_heating_events 
  WHERE timestamp < NOW() - INTERVAL '30 days';

  DELETE FROM room_recommendations 
  WHERE date < CURRENT_DATE - 7;

  DELETE FROM heating_recommendations 
  WHERE date < CURRENT_DATE - 7;

  DELETE FROM room_ml_features 
  WHERE date < CURRENT_DATE - 90;

  DELETE FROM learning_events 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  DELETE FROM api_errors 
  WHERE resolved_at IS NOT NULL 
    AND created_at < NOW() - INTERVAL '7 days';
  
  DELETE FROM api_errors 
  WHERE created_at < NOW() - INTERVAL '30 days';

  DELETE FROM pv_forecasts 
  WHERE date < CURRENT_DATE - 7;

  UPDATE data_retention_settings 
  SET last_cleanup_at = NOW(), updated_at = NOW();
END;
$function$;

-- function: close_previous_price_history
CREATE OR REPLACE FUNCTION public.close_previous_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.energy_price_history
  SET valid_to = NEW.valid_from - INTERVAL '1 day'
  WHERE id <> NEW.id
    AND valid_to IS NULL
    AND valid_from < NEW.valid_from;
  RETURN NEW;
END;
$function$;

-- function: expire_stale_thermostat_commands
CREATE OR REPLACE FUNCTION public.expire_stale_thermostat_commands()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected_count integer;
  caller_role text;
BEGIN
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'postgres'
  );

  IF caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Unauthorized: expire_stale_thermostat_commands can only be called by service_role or pg_cron';
  END IF;

  UPDATE public.thermostat_commands
  SET status = 'expired',
      error_message = 'Auto-expired: kein Worker hat Command innerhalb 2h abgeholt',
      executed_at = NOW()
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '2 hours';

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$function$;

-- function: get_heating_history
CREATE OR REPLACE FUNCTION public.get_heating_history(days_back integer DEFAULT 7)
 RETURNS TABLE(local_date date, room_id uuid, room_name text, cycles integer, total_minutes integer, total_energy_wh numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH stop_events AS (
    SELECT 
      l.id,
      l.room_id,
      l.timestamp,
      l.duration_minutes,
      l.energy_estimate_wh,
      l.event_type,
      r.name as room_name,
      COALESCE(r.calculated_power_w, r.heating_power_w, 
        CASE WHEN r.floor_area_m2 IS NOT NULL THEN r.floor_area_m2 * 60 ELSE 800 END
      ) as room_power_w
    FROM room_heating_logs l
    JOIN rooms r ON r.id = l.room_id
    WHERE l.event_type IN ('heating_stop', 'solar_limit_stop')
      AND l.timestamp >= (CURRENT_DATE - days_back) AT TIME ZONE 'Europe/Berlin'
  ),
  events_with_energy AS (
    SELECT 
      se.id,
      se.room_id,
      se.room_name,
      se.timestamp,
      COALESCE(se.duration_minutes, 
        CASE 
          WHEN se.event_type = 'solar_limit_stop' THEN
            GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
              se.timestamp - COALESCE(
                (SELECT MAX(l2.timestamp) 
                 FROM room_heating_logs l2 
                 WHERE l2.room_id = se.room_id 
                   AND l2.event_type = 'solar_limit_start'
                   AND l2.timestamp < se.timestamp
                   AND l2.timestamp > se.timestamp - INTERVAL '4 hours'),
                se.timestamp - INTERVAL '2 minutes'
              )
            )) / 60))::integer
          ELSE 0
        END
      ) as effective_duration_min,
      COALESCE(se.energy_estimate_wh,
        CASE 
          WHEN se.duration_minutes IS NOT NULL THEN
            ROUND((se.room_power_w * se.duration_minutes / 60.0))
          WHEN se.event_type = 'solar_limit_stop' THEN
            ROUND((se.room_power_w * GREATEST(1, LEAST(240, EXTRACT(EPOCH FROM (
              se.timestamp - COALESCE(
                (SELECT MAX(l2.timestamp) 
                 FROM room_heating_logs l2 
                 WHERE l2.room_id = se.room_id 
                   AND l2.event_type = 'solar_limit_start'
                   AND l2.timestamp < se.timestamp
                   AND l2.timestamp > se.timestamp - INTERVAL '4 hours'),
                se.timestamp - INTERVAL '2 minutes'
              )
            )) / 60)) / 60.0))
          ELSE 0
        END
      ) as effective_energy_wh
    FROM stop_events se
  )
  SELECT 
    DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin') as local_date,
    ewe.room_id,
    ewe.room_name,
    COUNT(*)::integer as cycles,
    COALESCE(SUM(ewe.effective_duration_min), 0)::integer as total_minutes,
    COALESCE(SUM(ewe.effective_energy_wh), 0)::numeric as total_energy_wh
  FROM events_with_energy ewe
  WHERE ewe.effective_duration_min > 0 
    AND ewe.effective_duration_min <= 240
  GROUP BY DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin'), ewe.room_id, ewe.room_name
  ORDER BY DATE(ewe.timestamp AT TIME ZONE 'Europe/Berlin') DESC, ewe.room_name;
END;
$function$;

-- function: get_ml_follow_rate
CREATE OR REPLACE FUNCTION public.get_ml_follow_rate(days_back integer DEFAULT 7)
 RETURNS TABLE(day date, total_with_ml bigint, followed bigint, overridden bigint, reward_when_followed numeric, reward_when_overridden numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    (date_trunc('day', timestamp AT TIME ZONE 'Europe/Vienna'))::date AS day,
    COUNT(*) FILTER (WHERE action ? 'ml_recommendation')::bigint AS total_with_ml,
    COUNT(*) FILTER (WHERE (action->>'ml_followed')::boolean = true)::bigint AS followed,
    COUNT(*) FILTER (WHERE (action->>'ml_followed')::boolean = false)::bigint AS overridden,
    AVG(reward) FILTER (WHERE (action->>'ml_followed')::boolean = true AND reward IS NOT NULL)::numeric AS reward_when_followed,
    AVG(reward) FILTER (WHERE (action->>'ml_followed')::boolean = false AND reward IS NOT NULL)::numeric AS reward_when_overridden
  FROM public.learning_events
  WHERE timestamp >= now() - (days_back || ' days')::interval
    AND action ? 'ml_recommendation'
  GROUP BY 1
  ORDER BY 1 DESC;
$function$;

-- function: get_weekly_energy_summary
CREATE OR REPLACE FUNCTION public.get_weekly_energy_summary(days_back integer DEFAULT 7)
 RETURNS TABLE(date date, peak_power numeric, avg_power numeric, energy_in_kwh numeric, energy_out_kwh numeric, feed_in_kwh numeric, pv_kwh numeric, heating_kwh numeric, avg_outdoor_c numeric, reading_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (days_back - 1)),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::date AS d
  ),
  energy AS (
    SELECT
      (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      MAX(power_io) AS peak_power,
      AVG(power_io) AS avg_power,
      COALESCE(SUM(pv_power) / 60000.0, 0) AS pv_kwh,
      COUNT(*)::integer AS reading_count
    FROM energy_readings
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  ),
  hourly AS (
    SELECT
      (hour_start AT TIME ZONE 'Europe/Vienna')::date AS d,
      COALESCE(SUM(total_energy_in), 0) AS energy_in_kwh,
      COALESCE(SUM(total_energy_out), 0) AS energy_out_kwh
    FROM hourly_aggregates
    WHERE hour_start >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  ),
  hourly_per_hour AS (
    SELECT
      date_trunc('hour', timestamp AT TIME ZONE 'Europe/Vienna') AS h,
      GREATEST(MAX(energy_in) - MIN(energy_in), 0) AS in_kwh,
      GREATEST(MAX(energy_out) - MIN(energy_out), 0) AS out_kwh
    FROM energy_readings
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  ),
  hourly_fb_day AS (
    SELECT h::date AS d, SUM(in_kwh) AS energy_in_kwh, SUM(out_kwh) AS energy_out_kwh
    FROM hourly_per_hour GROUP BY h::date
  ),
  heating AS (
    SELECT
      (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      COALESCE(SUM(energy_estimate_wh) / 1000.0, 0) AS heating_kwh
    FROM room_heating_logs
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
      AND event_type IN ('heating_stop', 'solar_limit_stop')
    GROUP BY 1
  ),
  weather AS (
    SELECT
      (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      AVG(temperature_c) AS avg_outdoor_c
    FROM weather_data
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  )
  SELECT
    days.d AS date,
    COALESCE(e.peak_power, 0)::numeric,
    COALESCE(e.avg_power, 0)::numeric,
    COALESCE(NULLIF(h.energy_in_kwh, 0), hfb.energy_in_kwh, 0)::numeric,
    COALESCE(NULLIF(h.energy_out_kwh, 0), hfb.energy_out_kwh, 0)::numeric,
    COALESCE(NULLIF(h.energy_out_kwh, 0), hfb.energy_out_kwh, 0)::numeric AS feed_in_kwh,
    COALESCE(e.pv_kwh, 0)::numeric,
    COALESCE(hl.heating_kwh, 0)::numeric,
    w.avg_outdoor_c::numeric,
    COALESCE(e.reading_count, 0)
  FROM days
  LEFT JOIN energy e ON e.d = days.d
  LEFT JOIN hourly h ON h.d = days.d
  LEFT JOIN hourly_fb_day hfb ON hfb.d = days.d
  LEFT JOIN heating hl ON hl.d = days.d
  LEFT JOIN weather w ON w.d = days.d
  ORDER BY days.d DESC;
$function$;

-- function: match_today_pattern
CREATE OR REPLACE FUNCTION public.match_today_pattern(today_signature jsonb, top_n integer DEFAULT 3)
 RETURNS TABLE(date date, sig_weather text, sig_pv_bucket text, sig_temp_bucket text, sig_weekday text, kpi_self_consumption_ratio numeric, kpi_pv_heating_coverage numeric, score numeric, settings_snapshot jsonb, match_quality text, match_dimensions integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w text := today_signature->>'sig_weather';
  pv text := today_signature->>'sig_pv_bucket';
  t text := today_signature->>'sig_temp_bucket';
  wd text := today_signature->>'sig_weekday';
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      d.*,
      ((d.sig_weather = w)::int +
       (d.sig_pv_bucket = pv)::int +
       (d.sig_temp_bucket = t)::int +
       (d.sig_weekday = wd)::int) AS match_dim
    FROM public.daily_pattern_scores d
    WHERE d.date < CURRENT_DATE
  ),
  ranked AS (
    SELECT s.*,
      CASE
        WHEN s.match_dim = 4 THEN 'exact'
        WHEN s.match_dim = 3 THEN 'partial'
        WHEN s.sig_pv_bucket = pv THEN 'weak'
        ELSE NULL
      END AS quality
    FROM scored s
    WHERE s.match_dim >= 3 OR s.sig_pv_bucket = pv
  )
  SELECT
    r.date, r.sig_weather, r.sig_pv_bucket, r.sig_temp_bucket, r.sig_weekday,
    r.kpi_self_consumption_ratio, r.kpi_pv_heating_coverage,
    r.score, r.settings_snapshot, r.quality, r.match_dim
  FROM ranked r
  WHERE r.quality IS NOT NULL
  ORDER BY
    CASE r.quality WHEN 'exact' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,
    r.score DESC
  LIMIT top_n;
END;
$function$;

-- function: protect_rooms_sensitive_columns
CREATE OR REPLACE FUNCTION public.protect_rooms_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_role text;
BEGIN
  caller_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );

  -- service_role und postgres dürfen alles ändern
  IF caller_role IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Authenticated users dürfen alles ändern
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Anon: sensible Spalten zurücksetzen
  NEW.local_key := OLD.local_key;
  NEW.tuya_device_id := OLD.tuya_device_id;
  NEW.thermostat_ip := OLD.thermostat_ip;
  NEW.thermostat_local_ip := OLD.thermostat_local_ip;
  NEW.name := OLD.name;
  NEW.comfort_temp := OLD.comfort_temp;
  NEW.eco_temp := OLD.eco_temp;
  NEW.night_temp := OLD.night_temp;
  NEW.priority := OLD.priority;
  NEW.floor_area_m2 := OLD.floor_area_m2;
  NEW.orientation := OLD.orientation;
  NEW.heating_power_w := OLD.heating_power_w;
  NEW.automation_enabled := OLD.automation_enabled;
  NEW.pv_boost_max_temp := OLD.pv_boost_max_temp;
  NEW.solar_limit_temp := OLD.solar_limit_temp;
  NEW.solar_heating_temp := OLD.solar_heating_temp;
  NEW.has_solar_gain := OLD.has_solar_gain;
  NEW.pv_auto_enabled := OLD.pv_auto_enabled;
  RETURN NEW;
END;
$function$;

-- function: update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- function: validate_ai_auto_apply
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

-- function: validate_energy_reading
CREATE OR REPLACE FUNCTION public.validate_energy_reading()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate power_io range (-50000 to 50000 watts)
  IF NEW.power_io < -50000 OR NEW.power_io > 50000 THEN
    RAISE EXCEPTION 'power_io out of valid range (-50000 to 50000)';
  END IF;
  
  -- Validate energy values are non-negative
  IF NEW.energy_in < 0 OR NEW.energy_out < 0 THEN
    RAISE EXCEPTION 'energy_in and energy_out must be non-negative';
  END IF;
  
  -- Validate battery_soc range (0-100) if provided
  IF NEW.battery_soc IS NOT NULL AND (NEW.battery_soc < 0 OR NEW.battery_soc > 100) THEN
    RAISE EXCEPTION 'battery_soc must be between 0 and 100';
  END IF;
  
  -- Validate pv_power range if provided (0 to 50000)
  IF NEW.pv_power IS NOT NULL AND (NEW.pv_power < 0 OR NEW.pv_power > 50000) THEN
    RAISE EXCEPTION 'pv_power must be between 0 and 50000';
  END IF;
  
  -- Validate consumption range if provided
  IF NEW.consumption IS NOT NULL AND (NEW.consumption < 0 OR NEW.consumption > 100000) THEN
    RAISE EXCEPTION 'consumption must be between 0 and 100000';
  END IF;
  
  -- Reject future timestamps (more than 5 minutes ahead)
  IF NEW.timestamp > NOW() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'timestamp cannot be in the future';
  END IF;
  
  RETURN NEW;
END;
$function$;

-- function: validate_learned_policy_hour
CREATE OR REPLACE FUNCTION public.validate_learned_policy_hour()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.hour_of_day < 0 OR NEW.hour_of_day > 23 THEN
    RAISE EXCEPTION 'hour_of_day must be between 0 and 23';
  END IF;
  RETURN NEW;
END;
$function$;


-- ===== 2) TRIGGER (16) =====

DROP TRIGGER IF EXISTS "update_ai_daily_plans_updated_at" ON public."ai_daily_plans";
CREATE TRIGGER update_ai_daily_plans_updated_at BEFORE UPDATE ON public.ai_daily_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_ai_parameter_whitelist_updated_at" ON public."ai_parameter_whitelist";
CREATE TRIGGER trg_ai_parameter_whitelist_updated_at BEFORE UPDATE ON public.ai_parameter_whitelist FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_battery_daily_tracking_updated_at" ON public."battery_daily_tracking";
CREATE TRIGGER update_battery_daily_tracking_updated_at BEFORE UPDATE ON public.battery_daily_tracking FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_dps_updated_at" ON public."daily_pattern_scores";
CREATE TRIGGER trg_dps_updated_at BEFORE UPDATE ON public.daily_pattern_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_data_retention_settings_updated_at" ON public."data_retention_settings";
CREATE TRIGGER update_data_retention_settings_updated_at BEFORE UPDATE ON public.data_retention_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_energy_daily_costs_updated_at" ON public."energy_daily_costs";
CREATE TRIGGER update_energy_daily_costs_updated_at BEFORE UPDATE ON public.energy_daily_costs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_close_previous_price_history" ON public."energy_price_history";
CREATE TRIGGER trg_close_previous_price_history AFTER INSERT ON public.energy_price_history FOR EACH ROW EXECUTE FUNCTION close_previous_price_history();

DROP TRIGGER IF EXISTS "validate_energy_reading_trigger" ON public."energy_readings";
CREATE TRIGGER validate_energy_reading_trigger BEFORE INSERT OR UPDATE ON public.energy_readings FOR EACH ROW EXECUTE FUNCTION validate_energy_reading();

DROP TRIGGER IF EXISTS "tr_validate_ai_auto_apply" ON public."heating_settings";
CREATE TRIGGER tr_validate_ai_auto_apply BEFORE UPDATE ON public.heating_settings FOR EACH ROW EXECUTE FUNCTION validate_ai_auto_apply();

DROP TRIGGER IF EXISTS "validate_learned_policy_hour_trigger" ON public."learned_policies";
CREATE TRIGGER validate_learned_policy_hour_trigger BEFORE INSERT OR UPDATE ON public.learned_policies FOR EACH ROW EXECUTE FUNCTION validate_learned_policy_hour();

DROP TRIGGER IF EXISTS "update_room_ml_features_updated_at" ON public."room_ml_features";
CREATE TRIGGER update_room_ml_features_updated_at BEFORE UPDATE ON public.room_ml_features FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "protect_rooms_sensitive_columns_trigger" ON public."rooms";
CREATE TRIGGER protect_rooms_sensitive_columns_trigger BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION protect_rooms_sensitive_columns();

DROP TRIGGER IF EXISTS "trg_capture_room_temperature_sample" ON public."rooms";
CREATE TRIGGER trg_capture_room_temperature_sample AFTER UPDATE OF current_temp, is_heating, last_thermostat_sync ON public.rooms FOR EACH ROW EXECUTE FUNCTION capture_room_temperature_sample();

DROP TRIGGER IF EXISTS "update_rooms_updated_at" ON public."rooms";
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_service_health_updated_at" ON public."service_health";
CREATE TRIGGER update_service_health_updated_at BEFORE UPDATE ON public.service_health FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_system_settings_updated_at" ON public."system_settings";
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ===== 3) RLS aktivieren (33 Tabellen) =====

ALTER TABLE public."ai_daily_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ai_parameter_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ai_parameter_whitelist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."api_errors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."battery_daily_tracking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."battery_soc_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."consumer_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_pattern_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_retention_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."detected_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."energy_daily_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."energy_price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."energy_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."heating_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."heating_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."hourly_aggregates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."learned_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."learning_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."price_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pv_forecasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."room_heating_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."room_kpi_15min" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."room_ml_features" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."room_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."room_temperature_samples" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."service_health" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."smartfox_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."solar_heating_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."thermostat_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."weather_data
" ENABLE ROW LEVEL SECURITY;

-- ===== 4) RLS POLICIES (55) =====

CREATE POLICY "Anon can read daily plans" ON public."ai_daily_plans" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users full access" ON public."ai_daily_plans" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."ai_parameter_decisions" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."ai_parameter_whitelist" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can insert errors" ON public."api_errors" AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon collector can update errors" ON public."api_errors" AS PERMISSIVE FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."api_errors" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can insert tracking" ON public."battery_daily_tracking" AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon collector can read tracking" ON public."battery_daily_tracking" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon collector can update tracking" ON public."battery_daily_tracking" AS PERMISSIVE FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."battery_daily_tracking" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon can read suggestions" ON public."battery_soc_suggestions" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users full access" ON public."battery_soc_suggestions" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."consumer_logs" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."daily_pattern_scores" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."daily_patterns" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can read retention settings" ON public."data_retention_settings" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users full access" ON public."data_retention_settings" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."detected_patterns" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."energy_daily_costs" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon can read price history" ON public."energy_price_history" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users full access price history" ON public."energy_price_history" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can insert energy readings" ON public."energy_readings" AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."energy_readings" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."heating_recommendations" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."heating_settings" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."hourly_aggregates" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."learned_policies" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."learning_events" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon can read suggestions" ON public."price_suggestions" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon collector can insert suggestions" ON public."price_suggestions" AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access suggestions" ON public."price_suggestions" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."pv_forecasts" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."room_heating_logs" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can read room_kpi_15min" ON public."room_kpi_15min" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users full access on room_kpi_15min" ON public."room_kpi_15min" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."room_ml_features" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."room_recommendations" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."room_temperature_samples" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can read rooms" ON public."rooms" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon collector can update rooms" ON public."rooms" AS PERMISSIVE FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."rooms" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can insert service health" ON public."service_health" AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon collector can read service health" ON public."service_health" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon collector can update service health" ON public."service_health" AS PERMISSIVE FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."service_health" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."smartfox_settings" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."solar_heating_events" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users can insert system settings" ON public."system_settings" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users can read system settings" ON public."system_settings" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users can update system settings" ON public."system_settings" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Anon collector can read commands" ON public."thermostat_commands" AS PERMISSIVE FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon collector can update commands" ON public."thermostat_commands" AS PERMISSIVE FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access" ON public."thermostat_commands" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Authenticated users full access" ON public."weather_data" AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL)
);



-- ===== 5) GRANTS (Tabellen) =====

GRANT ALL ON public."ai_daily_plans" TO anon;
GRANT ALL ON public."ai_daily_plans" TO authenticated;
GRANT ALL ON public."ai_daily_plans" TO service_role;
GRANT ALL ON public."ai_parameter_decisions" TO anon;
GRANT ALL ON public."ai_parameter_decisions" TO authenticated;
GRANT ALL ON public."ai_parameter_decisions" TO service_role;
GRANT ALL ON public."ai_parameter_whitelist" TO anon;
GRANT ALL ON public."ai_parameter_whitelist" TO authenticated;
GRANT ALL ON public."ai_parameter_whitelist" TO service_role;
GRANT ALL ON public."api_errors" TO anon;
GRANT ALL ON public."api_errors" TO authenticated;
GRANT ALL ON public."api_errors" TO service_role;
GRANT ALL ON public."battery_daily_tracking" TO anon;
GRANT ALL ON public."battery_daily_tracking" TO authenticated;
GRANT ALL ON public."battery_daily_tracking" TO service_role;
GRANT ALL ON public."battery_soc_suggestions" TO anon;
GRANT ALL ON public."battery_soc_suggestions" TO authenticated;
GRANT ALL ON public."battery_soc_suggestions" TO service_role;
GRANT ALL ON public."consumer_logs" TO anon;
GRANT ALL ON public."consumer_logs" TO authenticated;
GRANT ALL ON public."consumer_logs" TO service_role;
GRANT ALL ON public."daily_pattern_scores" TO anon;
GRANT ALL ON public."daily_pattern_scores" TO authenticated;
GRANT ALL ON public."daily_pattern_scores" TO service_role;
GRANT ALL ON public."daily_patterns" TO anon;
GRANT ALL ON public."daily_patterns" TO authenticated;
GRANT ALL ON public."daily_patterns" TO service_role;
GRANT ALL ON public."data_retention_settings" TO anon;
GRANT ALL ON public."data_retention_settings" TO authenticated;
GRANT ALL ON public."data_retention_settings" TO service_role;
GRANT ALL ON public."detected_patterns" TO anon;
GRANT ALL ON public."detected_patterns" TO authenticated;
GRANT ALL ON public."detected_patterns" TO service_role;
GRANT ALL ON public."energy_daily_costs" TO anon;
GRANT ALL ON public."energy_daily_costs" TO authenticated;
GRANT ALL ON public."energy_daily_costs" TO service_role;
GRANT ALL ON public."energy_price_history" TO anon;
GRANT ALL ON public."energy_price_history" TO authenticated;
GRANT ALL ON public."energy_price_history" TO service_role;
GRANT ALL ON public."energy_readings" TO anon;
GRANT ALL ON public."energy_readings" TO authenticated;
GRANT ALL ON public."energy_readings" TO service_role;
GRANT ALL ON public."heating_recommendations" TO anon;
GRANT ALL ON public."heating_recommendations" TO authenticated;
GRANT ALL ON public."heating_recommendations" TO service_role;
GRANT ALL ON public."heating_settings" TO anon;
GRANT ALL ON public."heating_settings" TO authenticated;
GRANT ALL ON public."heating_settings" TO service_role;
GRANT ALL ON public."hourly_aggregates" TO anon;
GRANT ALL ON public."hourly_aggregates" TO authenticated;
GRANT ALL ON public."hourly_aggregates" TO service_role;
GRANT ALL ON public."learned_policies" TO anon;
GRANT ALL ON public."learned_policies" TO authenticated;
GRANT ALL ON public."learned_policies" TO service_role;
GRANT ALL ON public."learning_events" TO anon;
GRANT ALL ON public."learning_events" TO authenticated;
GRANT ALL ON public."learning_events" TO service_role;
GRANT ALL ON public."price_suggestions" TO anon;
GRANT ALL ON public."price_suggestions" TO authenticated;
GRANT ALL ON public."price_suggestions" TO service_role;
GRANT ALL ON public."pv_forecasts" TO anon;
GRANT ALL ON public."pv_forecasts" TO authenticated;
GRANT ALL ON public."pv_forecasts" TO service_role;
GRANT ALL ON public."room_heating_logs" TO anon;
GRANT ALL ON public."room_heating_logs" TO authenticated;
GRANT ALL ON public."room_heating_logs" TO service_role;
GRANT ALL ON public."room_kpi_15min" TO anon;
GRANT ALL ON public."room_kpi_15min" TO authenticated;
GRANT ALL ON public."room_kpi_15min" TO service_role;
GRANT ALL ON public."room_ml_features" TO anon;
GRANT ALL ON public."room_ml_features" TO authenticated;
GRANT ALL ON public."room_ml_features" TO service_role;
GRANT ALL ON public."room_recommendations" TO anon;
GRANT ALL ON public."room_recommendations" TO authenticated;
GRANT ALL ON public."room_recommendations" TO service_role;
GRANT ALL ON public."room_temperature_samples" TO anon;
GRANT ALL ON public."room_temperature_samples" TO authenticated;
GRANT ALL ON public."room_temperature_samples" TO service_role;
GRANT ALL ON public."rooms" TO anon;
GRANT ALL ON public."rooms" TO authenticated;
GRANT ALL ON public."rooms" TO service_role;
GRANT ALL ON public."service_health" TO anon;
GRANT ALL ON public."service_health" TO authenticated;
GRANT ALL ON public."service_health" TO service_role;
GRANT ALL ON public."smartfox_settings" TO anon;
GRANT ALL ON public."smartfox_settings" TO authenticated;
GRANT ALL ON public."smartfox_settings" TO service_role;
GRANT ALL ON public."solar_heating_events" TO anon;
GRANT ALL ON public."solar_heating_events" TO authenticated;
GRANT ALL ON public."solar_heating_events" TO service_role;
GRANT ALL ON public."system_settings" TO anon;
GRANT ALL ON public."system_settings" TO authenticated;
GRANT ALL ON public."system_settings" TO service_role;
GRANT ALL ON public."thermostat_commands" TO anon;
GRANT ALL ON public."thermostat_commands" TO authenticated;
GRANT ALL ON public."thermostat_commands" TO service_role;
GRANT ALL ON public."weather_data" TO anon;
GRANT ALL ON public."weather_data" TO authenticated;
GRANT SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public."weather_data" TO service_role;


-- ===== 6) GRANTS (Funktionen, EXECUTE) =====

GRANT EXECUTE ON FUNCTION public."capture_room_temperature_sample"() TO service_role;
GRANT EXECUTE ON FUNCTION public."cleanup_ai_parameter_decisions"() TO service_role;
GRANT EXECUTE ON FUNCTION public."cleanup_old_data"() TO service_role;
GRANT EXECUTE ON FUNCTION public."close_previous_price_history"() TO service_role;
GRANT EXECUTE ON FUNCTION public."expire_stale_thermostat_commands"() TO service_role;
GRANT EXECUTE ON FUNCTION public."get_heating_history"(days_back integer) TO anon;
GRANT EXECUTE ON FUNCTION public."get_heating_history"(days_back integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public."get_heating_history"(days_back integer) TO service_role;
GRANT EXECUTE ON FUNCTION public."get_ml_follow_rate"(days_back integer) TO anon;
GRANT EXECUTE ON FUNCTION public."get_ml_follow_rate"(days_back integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public."get_ml_follow_rate"(days_back integer) TO service_role;
GRANT EXECUTE ON FUNCTION public."get_weekly_energy_summary"(days_back integer) TO anon;
GRANT EXECUTE ON FUNCTION public."get_weekly_energy_summary"(days_back integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public."get_weekly_energy_summary"(days_back integer) TO service_role;
GRANT EXECUTE ON FUNCTION public."match_today_pattern"(today_signature jsonb, top_n integer) TO anon;
GRANT EXECUTE ON FUNCTION public."match_today_pattern"(today_signature jsonb, top_n integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public."match_today_pattern"(today_signature jsonb, top_n integer) TO service_role;
GRANT EXECUTE ON FUNCTION public."protect_rooms_sensitive_columns"() TO service_role;
GRANT EXECUTE ON FUNCTION public."update_updated_at_column"() TO service_role;
GRANT EXECUTE ON FUNCTION public."validate_ai_auto_apply"() TO service_role;
GRANT EXECUTE ON FUNCTION public."validate_energy_reading"() TO service_role;
GRANT EXECUTE ON FUNCTION public."validate_learned_policy_hour"() TO service_role
;
