-- 60_tagesenergie_zeitgewichtet.sql  (25.11.2026)
-- Fehler: get_weekly_energy_summary rechnete Energie mit festen 120 Messungen pro Stunde (30-s-Takt).
--         Seit ~08.07.2026 kommt energy_readings alle 300 s → pv_kwh, energy_in/out_kwh, feed_in_kwh
--         und damit daily_pattern_scores (pv_kwh, feed_in_kwh, kpi_grid_import_kwh) um Faktor 10 zu klein.
--         Gegenprobe: energie_tag (stimmt) und ÖMAG-Gutschrift September 315 (~980 kWh statt 98,5 kWh).
-- Lösung: Energie zeitgewichtet integrieren (Leistung × Abstand zur nächsten Messung, Lücken max. 600 s).
--         Unabhängig vom Messtakt. Doku: doc/FIX-TAGESENERGIE-FAKTOR10-2026-11-25.md
-- Score: compute-daily-score Netzbezug-Abzug 0,5 → 0,05 Punkte/kWh (max 20), damit der Score
--         gleich bleibt wie bisher (bisherige Werte waren 1/10).

-- 1) Funktion zeitgewichtet ---------------------------------------------------------------
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
  r AS (
    -- Abstand zur nächsten Messung in Sekunden; letzte Messung 300 s, Lücken auf 600 s begrenzt
    SELECT
      timestamp, power_io, pv_power,
      LEAST(COALESCE(EXTRACT(EPOCH FROM (LEAD(timestamp) OVER (ORDER BY timestamp) - timestamp)), 300), 600) AS dt
    FROM energy_readings
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
  ),
  energy AS (
    SELECT
      (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      MAX(power_io) AS peak_power,
      AVG(power_io) AS avg_power,
      -- W × s / 3.600.000 = kWh; power_io positiv = Netzbezug, negativ = Einspeisung
      COALESCE(SUM(COALESCE(pv_power, 0) * dt) / 3600000.0, 0) AS pv_kwh,
      COALESCE(SUM(GREATEST(power_io, 0) * dt) / 3600000.0, 0) AS energy_in_kwh,
      COALESCE(SUM(GREATEST(-power_io, 0) * dt) / 3600000.0, 0) AS energy_out_kwh,
      COUNT(*)::integer AS reading_count
    FROM r
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
    COALESCE(e.peak_power, 0)::numeric,
    COALESCE(e.avg_power, 0)::numeric,
    COALESCE(e.energy_in_kwh, 0)::numeric,
    COALESCE(e.energy_out_kwh, 0)::numeric,
    COALESCE(e.energy_out_kwh, 0)::numeric AS feed_in_kwh,
    COALESCE(e.pv_kwh, 0)::numeric,
    COALESCE(hl.heating_kwh, 0)::numeric,
    w.avg_outdoor_c::numeric,
    COALESCE(e.reading_count, 0)
  FROM days
  LEFT JOIN energy e ON e.d = days.d
  LEFT JOIN heating hl ON hl.d = days.d
  LEFT JOIN weather w ON w.d = days.d
  ORDER BY days.d DESC;
$function$;

-- 2) daily_pattern_scores korrigieren ------------------------------------------------------
-- 2a) ab 26.10.2026 liegen Rohdaten vor → exakt neu aus der Funktion
UPDATE daily_pattern_scores s
SET pv_kwh = f.pv_kwh,
    feed_in_kwh = f.feed_in_kwh,
    kpi_grid_import_kwh = f.energy_in_kwh,
    kpi_self_consumption_ratio = CASE WHEN f.pv_kwh > 0
      THEN GREATEST(0, LEAST(1, (f.pv_kwh - f.feed_in_kwh) / f.pv_kwh)) ELSE 0 END,
    updated_at = now()
FROM public.get_weekly_energy_summary(GREATEST(1, (CURRENT_DATE - DATE '2026-10-26') + 1)) f
WHERE s.date = f.date AND s.date >= DATE '2026-10-26' AND f.reading_count > 0;

-- 2b) 09.07.–25.10.2026: Rohdaten gelöscht, Messtakt war 300 s → Faktor 10
--     (Verhältnis Eigenverbrauch bleibt gleich, weil alle drei Werte gleich skaliert waren)
UPDATE daily_pattern_scores
SET pv_kwh = pv_kwh * 10,
    feed_in_kwh = feed_in_kwh * 10,
    kpi_grid_import_kwh = kpi_grid_import_kwh * 10,
    updated_at = now()
WHERE date BETWEEN DATE '2026-07-09' AND DATE '2026-10-25';

-- 2c) 08.07.2026: Umstellungstag (Takt wechselte im Laufe des Tages) → nicht rekonstruierbar
UPDATE daily_pattern_scores
SET pv_kwh = NULL, feed_in_kwh = NULL, kpi_grid_import_kwh = NULL, updated_at = now()
WHERE date = DATE '2026-07-08';
-- bis 07.07.2026: Takt 30 s, Werte waren richtig → unverändert

-- 3) Score nur ab 26.10.2026 neu (dort entspricht der gespeicherte Score der aktuellen Formel).
--    Ältere Tage behalten ihren Score: neuer Abzug 0,05 × (Netzbezug × 10) = alter Abzug 0,5 × Netzbezug.
--    (Ältere Zeilen wurden mit einer früheren Formel gerechnet, kpi_pv_heating_coverage fehlt dort –
--     ein Neurechnen würde sie verfälschen.) Rang bleibt, weil sich die Scores praktisch nicht ändern.
UPDATE daily_pattern_scores
SET score = GREATEST(0, LEAST(100,
      COALESCE(kpi_self_consumption_ratio, 0) * 60
    + COALESCE(kpi_pv_heating_coverage, 0) * 40
    - LEAST(20, COALESCE(kpi_grid_import_kwh, 0) * 0.05)))
WHERE date >= DATE '2026-10-26';

-- 4) Kontrolle: muss zu energie_tag passen (Verhältnis ≈ 1,0)
SELECT count(*) AS tage,
  round(avg(e.pv_kwh / nullif(d.pv_kwh, 0))::numeric, 3)            AS pv_verhaeltnis,
  round(avg(e.netz_kwh / nullif(d.kpi_grid_import_kwh, 0))::numeric, 3) AS netz_verhaeltnis,
  round(avg(e.einspeisung_kwh / nullif(d.feed_in_kwh, 0))::numeric, 3)  AS einspeisung_verhaeltnis
FROM daily_pattern_scores d JOIN energie_tag e ON e.tag = d.date
WHERE d.pv_kwh > 0.5 AND d.kpi_grid_import_kwh > 0.2 AND d.date >= DATE '2026-10-26';
