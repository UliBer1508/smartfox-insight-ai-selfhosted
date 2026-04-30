-- Function: expire stale pending thermostat commands
CREATE OR REPLACE FUNCTION public.expire_stale_thermostat_commands()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Schedule via pg_cron every 30 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-thermostat-commands') THEN
    PERFORM cron.unschedule('expire-stale-thermostat-commands');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-stale-thermostat-commands',
  '*/30 * * * *',
  $$ SELECT public.expire_stale_thermostat_commands(); $$
);