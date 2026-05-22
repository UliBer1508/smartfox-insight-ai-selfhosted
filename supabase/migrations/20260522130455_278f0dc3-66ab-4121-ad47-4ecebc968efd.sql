CREATE TABLE public.ai_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'claude-haiku',
  overall_strategy text,
  time_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  rooms jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_daily_plans_date ON public.ai_daily_plans(plan_date DESC);

ALTER TABLE public.ai_daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
ON public.ai_daily_plans FOR ALL
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Anon can read daily plans"
ON public.ai_daily_plans FOR SELECT
TO anon
USING (true);

CREATE TRIGGER update_ai_daily_plans_updated_at
BEFORE UPDATE ON public.ai_daily_plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();