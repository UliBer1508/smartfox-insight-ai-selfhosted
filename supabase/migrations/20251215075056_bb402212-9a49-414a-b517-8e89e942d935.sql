-- Tabelle für Rohdaten der Energiemessungen
CREATE TABLE public.energy_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  power_io NUMERIC NOT NULL,
  energy_in NUMERIC NOT NULL,
  energy_out NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index für schnelle Zeitabfragen
CREATE INDEX idx_energy_readings_timestamp ON public.energy_readings (timestamp DESC);

-- Tabelle für stündliche Aggregationen
CREATE TABLE public.hourly_aggregates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hour_start TIMESTAMPTZ NOT NULL,
  avg_power NUMERIC NOT NULL,
  max_power NUMERIC NOT NULL,
  min_power NUMERIC NOT NULL,
  total_energy_in NUMERIC NOT NULL,
  total_energy_out NUMERIC NOT NULL,
  reading_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(hour_start)
);

CREATE INDEX idx_hourly_aggregates_hour ON public.hourly_aggregates (hour_start DESC);

-- Tabelle für tägliche Muster
CREATE TABLE public.daily_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  peak_power NUMERIC NOT NULL,
  peak_time TIMESTAMPTZ,
  avg_power NUMERIC NOT NULL,
  total_energy_in NUMERIC NOT NULL,
  total_energy_out NUMERIC NOT NULL,
  net_energy NUMERIC NOT NULL,
  pattern_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date)
);

CREATE INDEX idx_daily_patterns_date ON public.daily_patterns (date DESC);

-- Tabelle für erkannte Muster (KI-Analyse)
CREATE TABLE public.detected_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_name TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC,
  start_time TIME,
  end_time TIME,
  avg_power NUMERIC,
  occurrence_days TEXT[],
  ai_analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabelle für Benutzer-Einstellungen
CREATE TABLE public.smartfox_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  smartfox_ip TEXT NOT NULL,
  polling_interval INTEGER NOT NULL DEFAULT 60,
  api_path TEXT DEFAULT '/power',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS deaktiviert da keine Benutzer-Authentifizierung (lokales Netzwerk)
ALTER TABLE public.energy_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartfox_settings ENABLE ROW LEVEL SECURITY;

-- Öffentliche Policies für lokale Nutzung
CREATE POLICY "Allow all operations on energy_readings" ON public.energy_readings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on hourly_aggregates" ON public.hourly_aggregates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on daily_patterns" ON public.daily_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on detected_patterns" ON public.detected_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on smartfox_settings" ON public.smartfox_settings FOR ALL USING (true) WITH CHECK (true);

-- Realtime für Live-Updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.energy_readings;