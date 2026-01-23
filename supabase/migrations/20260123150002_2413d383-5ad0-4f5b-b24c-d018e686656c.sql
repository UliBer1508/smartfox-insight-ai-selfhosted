-- Table for real-time solar heating observations
CREATE TABLE solar_heating_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  timestamp timestamptz DEFAULT now(),
  
  -- Measured values
  temp_start numeric NOT NULL,
  temp_current numeric NOT NULL,
  temp_change_per_hour numeric,
  duration_minutes integer,
  pv_power_w integer,
  is_heating boolean DEFAULT false,
  
  -- Analysis
  solar_gain_detected boolean DEFAULT false,
  heat_source text CHECK (heat_source IN ('solar', 'heating', 'both', 'none')),
  confidence numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now()
);

-- Index for efficient queries
CREATE INDEX idx_solar_heating_events_room_timestamp ON solar_heating_events(room_id, timestamp DESC);
CREATE INDEX idx_solar_heating_events_timestamp ON solar_heating_events(timestamp DESC);

-- Enable RLS
ALTER TABLE solar_heating_events ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Authenticated users full access" ON solar_heating_events
  FOR ALL USING (true) WITH CHECK (true);

-- Add solar_heating_temp column to rooms if not exists
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS solar_heating_temp numeric DEFAULT 17;