-- =====================================================================
-- smartfox-insight-ai : pg_cron Jobs (22 Stueck)
-- Neues Projekt: pflnniklvqbwjwrjswaz.supabase.co
-- Im SQL-Editor des NEUEN Supabase-Projekts ausfuehren.
--
-- >>> VOR DEM AUSFUEHREN: Platzhalter ersetzen <<<
--   __NEW_ANON_KEY__   = anon (public) Key des neuen Projekts
--                        -> reicht fuer ALLE HTTP-Jobs, da die Functions mit
--                           verify_jwt = false laufen (siehe supabase/config.toml).
--   (service_role wird fuer KEINEN dieser Jobs benoetigt. Falls du einzelne
--    Functions doch mit JWT-Pflicht deployst, dort __NEW_ANON_KEY__ durch
--    __NEW_SERVICE_ROLE_KEY__ ersetzen.)
--
-- Tipp: In diesem Editor einmal Suchen/Ersetzen:
--   __NEW_ANON_KEY__  ->  <dein neuer anon key>
--
-- Die 4 reinen DB-Jobs (expire-stale, ai-decisions-cleanup, beide
-- tuya-quota-resets) brauchen KEINEN Key - reine SQL-Aufrufe.
-- =====================================================================

-- Extensions sicherstellen
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Optional: vorhandene gleichnamige Jobs vorab entfernen (idempotent).
-- Bei einem frischen Projekt einfach ignorieren.
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'pv-automation-check','daily-solar-analysis','solar-heating-monitor',
    'fetch-pv-forecast-daily','update-learned-policies-daily','ml-feature-extraction-daily',
    'evaluate-decision-batch','aggregate-energy-data-daily','validate-battery-reserve-daily',
    'tuya-quota-daily-reset','tuya-quota-monthly-reset','expire-stale-thermostat-commands',
    'analysis-scheduler-15min','ai-parameter-evaluator-daily','auto-resolve-api-errors-5min',
    'ai-daily-planner-06am','ai-parameter-advisor-15min','ai-parameter-evaluator-hourly',
    'compute-daily-score-daily','daily-ai-decisions-cleanup','fetch-energy-prices-oemag-weekly',
    'fetch-energy-prices-salzburg-ag-monthly'
  ]
  LOOP
    PERFORM cron.unschedule(j) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);
  END LOOP;
END $$;


-- =====================================================================
-- A) REINE DB-JOBS (kein Key noetig)
-- =====================================================================

-- expire-stale-thermostat-commands : alle 30 Min
SELECT cron.schedule('expire-stale-thermostat-commands', '*/30 * * * *', $$
  SELECT public.expire_stale_thermostat_commands();
$$);

-- daily-ai-decisions-cleanup : taeglich 02:45
SELECT cron.schedule('daily-ai-decisions-cleanup', '45 2 * * *', $$
  SELECT public.cleanup_ai_parameter_decisions();
$$);

-- tuya-quota-daily-reset : taeglich 23:05 (calls_today -> 0)
SELECT cron.schedule('tuya-quota-daily-reset', '5 23 * * *', $$
  UPDATE system_settings
  SET value = jsonb_set(
                jsonb_set(value, '{calls_today}', '0'::jsonb),
                '{today}', to_jsonb(to_char((now() AT TIME ZONE 'Europe/Vienna')::date, 'YYYY-MM-DD'))),
      updated_at = now()
  WHERE key = 'tuya_api_quota';
$$);

-- tuya-quota-monthly-reset : am 1. des Monats 23:10 (calls_this_month -> 0)
SELECT cron.schedule('tuya-quota-monthly-reset', '10 23 1 * *', $$
  UPDATE system_settings
  SET value = jsonb_set(
                jsonb_set(value, '{calls_this_month}', '0'::jsonb),
                '{month}', to_jsonb(to_char((now() AT TIME ZONE 'Europe/Vienna')::date, 'YYYY-MM'))),
      updated_at = now()
  WHERE key = 'tuya_api_quota';
$$);


-- =====================================================================
-- B) HTTP-JOBS (Edge Functions)   ->   __NEW_ANON_KEY__ ersetzen
-- =====================================================================

-- pv-automation-check : alle 2 Min
SELECT cron.schedule('pv-automation-check', '*/2 * * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/pv-automation/check',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- evaluate-decision-batch : alle 2 Min
SELECT cron.schedule('evaluate-decision-batch', '*/2 * * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/evaluate-decision',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{"evaluate_all": true}'::jsonb
  ) AS request_id;
$$);

-- auto-resolve-api-errors-5min : alle 5 Min
SELECT cron.schedule('auto-resolve-api-errors-5min', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/auto-resolve-api-errors',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) AS request_id;
$$);

-- solar-heating-monitor : alle 15 Min, 06-20 Uhr
SELECT cron.schedule('solar-heating-monitor', '*/15 6-20 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/monitor-solar-heating',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- analysis-scheduler-15min : alle 15 Min
SELECT cron.schedule('analysis-scheduler-15min', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/analysis-scheduler',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- ai-parameter-advisor-15min : alle 15 Min, 05-21 Uhr
SELECT cron.schedule('ai-parameter-advisor-15min', '*/15 5-21 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/ai-parameter-advisor',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
$$);

-- ai-parameter-evaluator-hourly : stuendlich Minute 17
SELECT cron.schedule('ai-parameter-evaluator-hourly', '17 * * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/ai-parameter-evaluator',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
$$);

-- compute-daily-score-daily : taeglich 02:30
SELECT cron.schedule('compute-daily-score-daily', '30 2 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/compute-daily-score',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- aggregate-energy-data-daily : taeglich 03:00
SELECT cron.schedule('aggregate-energy-data-daily', '0 3 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/aggregate-energy-data',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{"time":"daily"}'::jsonb
  ) AS request_id;
$$);

-- ai-parameter-evaluator-daily : taeglich 03:15
SELECT cron.schedule('ai-parameter-evaluator-daily', '15 3 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/ai-parameter-evaluator',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- ai-daily-planner-06am : taeglich 05:00 (Server-UTC -> Europe/Vienna 06/07 Uhr)
SELECT cron.schedule('ai-daily-planner-06am', '0 5 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/ai-daily-planner',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- fetch-pv-forecast-daily : taeglich 06:00
SELECT cron.schedule('fetch-pv-forecast-daily', '0 6 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/fetch-pv-forecast',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- validate-battery-reserve-daily : taeglich 08:05
SELECT cron.schedule('validate-battery-reserve-daily', '5 8 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/validate-battery-reserve',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- ml-feature-extraction-daily : taeglich 18:00
SELECT cron.schedule('ml-feature-extraction-daily', '0 18 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/ml-feature-extraction',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- update-learned-policies-daily : taeglich 19:30
SELECT cron.schedule('update-learned-policies-daily', '30 19 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/update-learned-policies',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- daily-solar-analysis : taeglich 20:00
SELECT cron.schedule('daily-solar-analysis', '0 20 * * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/analyze-solar-gain',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- fetch-energy-prices-oemag-weekly : Montags 06:00
SELECT cron.schedule('fetch-energy-prices-oemag-weekly', '0 6 * * 1', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/fetch-energy-prices?source=oemag',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);

-- fetch-energy-prices-salzburg-ag-monthly : am 1. des Monats 06:00
SELECT cron.schedule('fetch-energy-prices-salzburg-ag-monthly', '0 6 1 * *', $$
  SELECT net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/fetch-energy-prices?source=salzburg_ag',
    headers := '{"Content-Type":"application/json","apikey":"__NEW_ANON_KEY__","Authorization":"Bearer __NEW_ANON_KEY__"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$$);


-- =====================================================================
-- KONTROLLE: nach dem Ausfuehren pruefen (muss 22 Zeilen liefern)
-- =====================================================================
-- SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobname;
