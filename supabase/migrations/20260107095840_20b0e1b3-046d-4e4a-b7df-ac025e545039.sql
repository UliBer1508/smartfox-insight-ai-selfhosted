-- Neue Tabelle für regelmäßige Temperaturmessungen
CREATE TABLE public.room_temperature_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperature NUMERIC NOT NULL,
  is_heating BOOLEAN NOT NULL DEFAULT false,
  pv_power_w INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index für effiziente Abfragen
CREATE INDEX idx_room_temp_samples_room_timestamp ON public.room_temperature_samples(room_id, timestamp DESC);
CREATE INDEX idx_room_temp_samples_timestamp ON public.room_temperature_samples(timestamp DESC);

-- RLS aktivieren
ALTER TABLE public.room_temperature_samples ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Allow all operations on room_temperature_samples" 
ON public.room_temperature_samples 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Neue Felder in rooms für berechnete Solargewinn-Werte
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS calculated_solar_gain_factor NUMERIC DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS solar_gain_confidence NUMERIC DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS solar_gain_samples INTEGER DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS calculated_heat_loss_rate NUMERIC DEFAULT 0;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS last_solar_analysis TIMESTAMPTZ;