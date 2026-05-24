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