
-- Learned Policies: Aggregierte beste Aktionen pro Raum und Stunde
CREATE TABLE public.learned_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  hour_of_day INTEGER NOT NULL,
  recommended_action TEXT NOT NULL DEFAULT 'keep',
  recommended_temp NUMERIC,
  avg_reward NUMERIC DEFAULT 0,
  sample_count INTEGER DEFAULT 0,
  success_rate NUMERIC DEFAULT 0,
  avg_grid_import_wh NUMERIC DEFAULT 0,
  avg_pv_usage_ratio NUMERIC DEFAULT 0,
  conditions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, hour_of_day)
);

-- Validation trigger instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_learned_policy_hour()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.hour_of_day < 0 OR NEW.hour_of_day > 23 THEN
    RAISE EXCEPTION 'hour_of_day must be between 0 and 23';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_learned_policy_hour_trigger
BEFORE INSERT OR UPDATE ON public.learned_policies
FOR EACH ROW EXECUTE FUNCTION public.validate_learned_policy_hour();

-- Enable RLS
ALTER TABLE public.learned_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access"
ON public.learned_policies
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for fast lookup during automation
CREATE INDEX idx_learned_policies_room_hour ON public.learned_policies(room_id, hour_of_day);
