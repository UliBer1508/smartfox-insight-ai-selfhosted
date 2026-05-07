CREATE OR REPLACE FUNCTION public.get_ml_follow_rate(days_back integer DEFAULT 7)
RETURNS TABLE(
  day date,
  total_with_ml bigint,
  followed bigint,
  overridden bigint,
  reward_when_followed numeric,
  reward_when_overridden numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;