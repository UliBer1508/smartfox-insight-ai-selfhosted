-- Add columns for local LAN communication to rooms table
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS local_key TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS thermostat_local_ip TEXT;

-- Create thermostat_commands table for command queue
CREATE TABLE IF NOT EXISTS thermostat_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
    command TEXT NOT NULL,
    value NUMERIC,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    executed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE thermostat_commands ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users
CREATE POLICY "Authenticated users full access" ON thermostat_commands 
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for immediate PWA updates
ALTER PUBLICATION supabase_realtime ADD TABLE thermostat_commands;

-- Index for fast pending command queries
CREATE INDEX IF NOT EXISTS idx_thermostat_commands_status ON thermostat_commands(status) 
  WHERE status = 'pending';