
CREATE OR REPLACE FUNCTION public.get_weekly_energy_summary(days_back integer DEFAULT 7)
RETURNS TABLE(
  date date,
  peak_power numeric,
  avg_power numeric,
  energy_in_kwh numeric,
  energy_out_kwh numeric,
  pv_kwh numeric,
  heating_kwh numeric,
  avg_outdoor_c numeric,
  reading_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
      GREATEST(MAX(energy_in) - MIN(energy_in), 0) AS energy_in_kwh,
      GREATEST(MAX(energy_out) - MIN(energy_out), 0) AS energy_out_kwh,
      -- pv_kwh: integriere pv_power (W) über Polling-Intervall (~60s) zu kWh
      COALESCE(SUM(pv_power) / 60000.0, 0) AS pv_kwh,
      COUNT(*)::integer AS reading_count
    FROM energy_readings
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
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
    COALESCE(e.peak_power, 0)::numeric AS peak_power,
    COALESCE(e.avg_power, 0)::numeric AS avg_power,
    COALESCE(e.energy_in_kwh, 0)::numeric AS energy_in_kwh,
    COALESCE(e.energy_out_kwh, 0)::numeric AS energy_out_kwh,
    COALESCE(e.pv_kwh, 0)::numeric AS pv_kwh,
    COALESCE(h.heating_kwh, 0)::numeric AS heating_kwh,
    w.avg_outdoor_c::numeric AS avg_outdoor_c,
    COALESCE(e.reading_count, 0) AS reading_count
  FROM days
  LEFT JOIN energy e ON e.d = days.d
  LEFT JOIN heating h ON h.d = days.d
  LEFT JOIN weather w ON w.d = days.d
  ORDER BY days.d DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_weekly_energy_summary(integer) TO authenticated, anon;
