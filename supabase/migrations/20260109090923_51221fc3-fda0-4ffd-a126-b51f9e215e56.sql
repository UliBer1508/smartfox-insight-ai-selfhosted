-- Add manual_override_until column to rooms table
ALTER TABLE rooms ADD COLUMN manual_override_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN rooms.manual_override_until IS 'Timestamp until which manual temperature setting is protected from automation';