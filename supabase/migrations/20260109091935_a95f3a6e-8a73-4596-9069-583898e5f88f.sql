-- Add night time configuration to heating_settings
ALTER TABLE heating_settings 
ADD COLUMN IF NOT EXISTS night_start_time TIME DEFAULT '22:00',
ADD COLUMN IF NOT EXISTS night_end_time TIME DEFAULT '06:00';