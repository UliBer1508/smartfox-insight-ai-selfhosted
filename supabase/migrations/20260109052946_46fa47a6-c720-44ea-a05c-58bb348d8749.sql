-- Tabelle für ML-Lernentscheidungen und deren Ergebnisse
CREATE TABLE public.learning_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_type TEXT NOT NULL, -- 'heating_on', 'heating_off', 'temp_change', 'preheat'
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  
  -- Kontext zum Zeitpunkt der Entscheidung
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Beispiel: { "battery_soc": 65, "pv_power_w": 3500, "consumption_w": 1200, "outdoor_temp_c": 5, "current_room_temp": 19.5 }
  
  -- Durchgeführte Aktion
  action JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Beispiel: { "target_temp": 21, "duration_minutes": 60 }
  
  -- Ergebnis nach der Entscheidung (wird später gefüllt)
  outcome JSONB,
  -- Beispiel: { "energy_used_wh": 1500, "temp_reached": 20.8, "duration_actual_min": 55, "grid_import_wh": 200 }
  
  -- Berechneter Reward (wird von evaluate-decision gefüllt)
  reward NUMERIC,
  reward_breakdown JSONB,
  -- Beispiel: { "energy_cost": -0.30, "comfort_bonus": 0.8, "pv_usage_bonus": 0.5, "total": 1.0 }
  
  -- Status
  evaluated_at TIMESTAMPTZ,
  is_evaluated BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index für schnelle Abfragen
CREATE INDEX idx_learning_events_room ON public.learning_events(room_id);
CREATE INDEX idx_learning_events_timestamp ON public.learning_events(timestamp DESC);
CREATE INDEX idx_learning_events_decision_type ON public.learning_events(decision_type);
CREATE INDEX idx_learning_events_unevaluated ON public.learning_events(is_evaluated) WHERE is_evaluated = false;

-- RLS aktivieren
ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on learning_events"
ON public.learning_events
FOR ALL
USING (true)
WITH CHECK (true);

-- Tabelle für Wetterdaten (Open-Meteo Integration)
CREATE TABLE public.weather_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  
  -- Aktuelle Wetterdaten
  temperature_c NUMERIC,
  apparent_temperature_c NUMERIC,
  humidity_percent NUMERIC,
  cloud_cover_percent NUMERIC,
  wind_speed_kmh NUMERIC,
  precipitation_mm NUMERIC,
  
  -- Sonnendaten
  is_day BOOLEAN,
  direct_radiation_wm2 NUMERIC,
  diffuse_radiation_wm2 NUMERIC,
  
  -- Metadaten
  source TEXT DEFAULT 'open-meteo',
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint für Timestamp (eine Messung pro Stunde)
  UNIQUE(timestamp)
);

CREATE INDEX idx_weather_data_timestamp ON public.weather_data(timestamp DESC);

ALTER TABLE public.weather_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on weather_data"
ON public.weather_data
FOR ALL
USING (true)
WITH CHECK (true);

-- Tabelle für berechnete ML-Features pro Raum
CREATE TABLE public.room_ml_features (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Thermische Eigenschaften (gelernt)
  heat_loss_rate_deg_per_hour NUMERIC, -- Grad-Verlust pro Stunde ohne Heizung
  heating_rate_deg_per_hour NUMERIC, -- Grad-Gewinn pro Stunde bei Heizung
  energy_per_degree_wh NUMERIC, -- Energieverbrauch pro Grad Erwärmung
  
  -- Solar-Gain Eigenschaften
  solar_gain_factor NUMERIC, -- Temperatur-Gewinn bei 1000W/m² Strahlung
  optimal_solar_hours TEXT[], -- Stunden mit bestem Solar-Gain ['10:00', '11:00', '12:00']
  
  -- Heizverhalten
  avg_heating_duration_min NUMERIC,
  avg_cycles_per_day NUMERIC,
  preheat_duration_for_1deg_min NUMERIC,
  
  -- Effizienz-Metriken
  pv_heating_ratio NUMERIC, -- Anteil PV-Strom bei Heizung (0-1)
  battery_dependency_ratio NUMERIC, -- Anteil Batterie-Strom bei Nacht-Heizung
  grid_import_ratio NUMERIC, -- Anteil Netzbezug
  
  -- Confidence
  confidence NUMERIC DEFAULT 0, -- 0-1, steigt mit mehr Datenpunkten
  sample_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(room_id, date)
);

CREATE INDEX idx_room_ml_features_room ON public.room_ml_features(room_id);
CREATE INDEX idx_room_ml_features_date ON public.room_ml_features(date DESC);

ALTER TABLE public.room_ml_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on room_ml_features"
ON public.room_ml_features
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger für updated_at
CREATE TRIGGER update_room_ml_features_updated_at
BEFORE UPDATE ON public.room_ml_features
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();