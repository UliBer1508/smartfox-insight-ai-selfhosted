-- Neue Spalten in heating_settings für PV-Automatik und Fußbodenheizung
ALTER TABLE public.heating_settings
ADD COLUMN IF NOT EXISTS pv_surplus_threshold_on INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS pv_surplus_threshold_off INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS min_switch_interval_min INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS consumer_priority TEXT DEFAULT 'battery,heating,car',
ADD COLUMN IF NOT EXISTS floor_heating_response_hours NUMERIC DEFAULT 2,
ADD COLUMN IF NOT EXISTS estrich_storage_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS car_charging_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS car_min_charge_power_w INTEGER DEFAULT 1380;

-- Neue Spalten in rooms für Verbrauchsanalyse
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS estimated_kwh_per_degree NUMERIC,
ADD COLUMN IF NOT EXISTS last_heating_duration_min INTEGER,
ADD COLUMN IF NOT EXISTS avg_heating_cycles_per_day NUMERIC;

-- Neue Tabelle für Heiz-Event-Logging
CREATE TABLE IF NOT EXISTS public.room_heating_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  event_type TEXT NOT NULL,
  current_temp NUMERIC,
  target_temp NUMERIC,
  duration_minutes INTEGER,
  energy_estimate_wh INTEGER,
  pv_surplus_w INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS für room_heating_logs
ALTER TABLE public.room_heating_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on room_heating_logs"
ON public.room_heating_logs
FOR ALL
USING (true)
WITH CHECK (true);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_room_heating_logs_room_id ON public.room_heating_logs(room_id);
CREATE INDEX IF NOT EXISTS idx_room_heating_logs_timestamp ON public.room_heating_logs(timestamp DESC);