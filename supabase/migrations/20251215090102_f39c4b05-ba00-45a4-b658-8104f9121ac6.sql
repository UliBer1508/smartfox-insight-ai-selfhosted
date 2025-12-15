-- Extend heating_settings with location and roof parameters
ALTER TABLE public.heating_settings 
ADD COLUMN IF NOT EXISTS latitude numeric DEFAULT 47.24983,
ADD COLUMN IF NOT EXISTS longitude numeric DEFAULT 12.25415,
ADD COLUMN IF NOT EXISTS roof_azimuth integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS roof_declination integer DEFAULT 35;

-- Create pv_forecasts table for storing weather/solar predictions
CREATE TABLE IF NOT EXISTS public.pv_forecasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL UNIQUE,
  expected_kwh numeric NOT NULL DEFAULT 0,
  hourly_watts jsonb DEFAULT '{}'::jsonb,
  sunrise time without time zone,
  sunset time without time zone,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on pv_forecasts
ALTER TABLE public.pv_forecasts ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (no auth required for this app)
CREATE POLICY "Allow all operations on pv_forecasts" 
ON public.pv_forecasts 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create index for date lookups
CREATE INDEX IF NOT EXISTS idx_pv_forecasts_date ON public.pv_forecasts(date);

-- Update existing heating_settings with user's location
UPDATE public.heating_settings 
SET latitude = 47.24983, 
    longitude = 12.25415, 
    roof_azimuth = 0, 
    roof_declination = 35
WHERE latitude IS NULL OR latitude = 47.24983;