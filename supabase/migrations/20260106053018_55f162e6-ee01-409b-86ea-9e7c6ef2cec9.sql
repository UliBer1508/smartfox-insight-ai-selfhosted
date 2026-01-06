-- Indizes für schnellere Abfragen
CREATE INDEX IF NOT EXISTS idx_energy_readings_timestamp 
ON energy_readings (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_hourly_aggregates_hour_start 
ON hourly_aggregates (hour_start DESC);

CREATE INDEX IF NOT EXISTS idx_daily_patterns_date 
ON daily_patterns (date DESC);

-- Neue Tabelle für Datenspeicherungs-Einstellungen
CREATE TABLE IF NOT EXISTS data_retention_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polling_interval_seconds INTEGER DEFAULT 300,
  raw_data_retention_days INTEGER DEFAULT 7,
  hourly_retention_days INTEGER DEFAULT 90,
  auto_cleanup_enabled BOOLEAN DEFAULT true,
  last_cleanup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger für updated_at
CREATE TRIGGER update_data_retention_settings_updated_at
BEFORE UPDATE ON data_retention_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- RLS für data_retention_settings (öffentlich lesbar/schreibbar da keine Auth)
ALTER TABLE data_retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to data_retention_settings"
ON data_retention_settings
FOR ALL
USING (true)
WITH CHECK (true);

-- Initiale Einstellungen einfügen
INSERT INTO data_retention_settings (polling_interval_seconds, raw_data_retention_days, hourly_retention_days, auto_cleanup_enabled)
VALUES (300, 7, 90, true)
ON CONFLICT DO NOTHING;