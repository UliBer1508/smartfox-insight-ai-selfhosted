ALTER TABLE public.learned_policies
  ADD COLUMN IF NOT EXISTS learning_confidence float DEFAULT 0;

COMMENT ON COLUMN public.learned_policies.learning_confidence IS
  'Konfidenz basierend auf Anzahl Samples: 1=0.26, 3=0.59, 10+=0.95';