
-- 1) daily_pattern_scores ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_pattern_scores (
  date date PRIMARY KEY,
  sig_weather text NOT NULL CHECK (sig_weather IN ('sunny','mixed','cloudy')),
  sig_pv_bucket text NOT NULL CHECK (sig_pv_bucket IN ('low','mid','high')),
  sig_temp_bucket text NOT NULL CHECK (sig_temp_bucket IN ('cold','mild','warm')),
  sig_weekday text NOT NULL CHECK (sig_weekday IN ('workday','weekend')),
  kpi_self_consumption_ratio numeric,
  kpi_pv_heating_coverage numeric,
  kpi_grid_import_kwh numeric,
  kpi_battery_end_soc numeric,
  pv_kwh numeric,
  feed_in_kwh numeric,
  heating_kwh numeric,
  expected_pv_kwh numeric,
  avg_outdoor_c numeric,
  score numeric NOT NULL DEFAULT 0,
  rank_in_signature int,
  settings_snapshot jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_pattern_scores_signature
  ON public.daily_pattern_scores (sig_weather, sig_pv_bucket, sig_temp_bucket, sig_weekday, score DESC);

ALTER TABLE public.daily_pattern_scores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_pattern_scores' AND policyname='Authenticated users full access') THEN
    CREATE POLICY "Authenticated users full access"
      ON public.daily_pattern_scores
      FOR ALL TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_dps_updated_at ON public.daily_pattern_scores;
CREATE TRIGGER trg_dps_updated_at
  BEFORE UPDATE ON public.daily_pattern_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) heating_settings: neue Felder ------------------------------------------
ALTER TABLE public.heating_settings
  ADD COLUMN IF NOT EXISTS analysis_daily_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_daily_time time DEFAULT '03:30',
  ADD COLUMN IF NOT EXISTS analysis_weekly_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_weekly_weekday int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analysis_weekly_time time DEFAULT '04:00',
  ADD COLUMN IF NOT EXISTS analysis_monthly_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_monthly_dom int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS analysis_monthly_time time DEFAULT '04:30',
  ADD COLUMN IF NOT EXISTS analysis_match_today_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_match_today_time time DEFAULT '05:30',
  ADD COLUMN IF NOT EXISTS pattern_recall_strength int DEFAULT 50;

-- 3) get_weekly_energy_summary fixen ----------------------------------------
DROP FUNCTION IF EXISTS public.get_weekly_energy_summary(integer);

CREATE FUNCTION public.get_weekly_energy_summary(days_back integer DEFAULT 7)
RETURNS TABLE(
  date date,
  peak_power numeric,
  avg_power numeric,
  energy_in_kwh numeric,
  energy_out_kwh numeric,
  feed_in_kwh numeric,
  pv_kwh numeric,
  heating_kwh numeric,
  avg_outdoor_c numeric,
  reading_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- 4) match_today_pattern ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_today_pattern(
  today_signature jsonb,
  top_n int DEFAULT 3
)
RETURNS TABLE(
  date date,
  sig_weather text,
  sig_pv_bucket text,
  sig_temp_bucket text,
  sig_weekday text,
  kpi_self_consumption_ratio numeric,
  kpi_pv_heating_coverage numeric,
  score numeric,
  settings_snapshot jsonb,
  match_quality text,
  match_dimensions int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    SELECT *,
      CASE
        WHEN match_dim = 4 THEN 'exact'
        WHEN match_dim = 3 THEN 'partial'
        WHEN sig_pv_bucket = pv THEN 'weak'
        ELSE NULL
      END AS quality
    FROM scored
    WHERE match_dim >= 3 OR sig_pv_bucket = pv
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
$$;
