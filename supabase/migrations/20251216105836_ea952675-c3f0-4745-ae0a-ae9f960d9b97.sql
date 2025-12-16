-- Add Fronius fields to smartfox_settings table
ALTER TABLE smartfox_settings 
ADD COLUMN IF NOT EXISTS fronius_ip text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS fronius_is_active boolean DEFAULT false;