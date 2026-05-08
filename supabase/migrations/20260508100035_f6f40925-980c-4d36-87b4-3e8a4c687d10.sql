-- Stop the redundant apply-heating-recommendations cron job.
-- pv-automation (every 2 min) is the sole setpoint authority.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-heating-recommendations') THEN
    PERFORM cron.unschedule('apply-heating-recommendations');
  END IF;
END $$;