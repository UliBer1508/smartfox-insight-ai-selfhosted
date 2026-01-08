-- Neue Tabelle für Verbraucher-Logs (E-Auto, Warmwasser, etc.)
CREATE TABLE public.consumer_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  consumer_type TEXT NOT NULL, -- 'car', 'hotwater', 'unknown'
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  avg_power_w INTEGER,
  max_power_w INTEGER,
  total_energy_wh INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.consumer_logs ENABLE ROW LEVEL SECURITY;

-- Policy für alle Operationen
CREATE POLICY "Allow all operations on consumer_logs" 
ON public.consumer_logs 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Index für schnelle Abfragen
CREATE INDEX idx_consumer_logs_type_time ON public.consumer_logs(consumer_type, start_time DESC);
CREATE INDEX idx_consumer_logs_active ON public.consumer_logs(is_active) WHERE is_active = true;