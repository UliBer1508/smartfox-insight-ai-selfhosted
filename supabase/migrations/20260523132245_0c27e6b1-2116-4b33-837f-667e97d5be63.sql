
CREATE OR REPLACE FUNCTION public.cleanup_ai_parameter_decisions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Schedule daily cleanup at 02:45 UTC
SELECT cron.unschedule('daily-ai-decisions-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-ai-decisions-cleanup');

SELECT cron.schedule(
  'daily-ai-decisions-cleanup',
  '45 2 * * *',
  $$ SELECT public.cleanup_ai_parameter_decisions(); $$
);
