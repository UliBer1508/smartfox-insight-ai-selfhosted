-- Extend energy_readings with battery and PV data
ALTER TABLE public.energy_readings 
ADD COLUMN IF NOT EXISTS battery_soc numeric,
ADD COLUMN IF NOT EXISTS pv_power numeric,
ADD COLUMN IF NOT EXISTS consumption numeric;

-- Create heating_recommendations table
CREATE TABLE public.heating_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,
  period_number integer NOT NULL CHECK (period_number >= 1 AND period_number <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  recommended_temp numeric NOT NULL,
  reason text,
  expected_pv_surplus numeric,
  priority text CHECK (priority IN ('battery', 'heating', 'conservation')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(date, period_number)
);

-- Enable RLS
ALTER TABLE public.heating_recommendations ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (local usage)
CREATE POLICY "Allow all operations on heating_recommendations" 
ON public.heating_recommendations 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create heating_settings table for user preferences
CREATE TABLE public.heating_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pv_capacity_kwp numeric NOT NULL DEFAULT 15.8,
  battery_capacity_kwh numeric NOT NULL DEFAULT 13.8,
  min_battery_soc numeric NOT NULL DEFAULT 20,
  target_battery_soc numeric NOT NULL DEFAULT 80,
  comfort_temp numeric NOT NULL DEFAULT 21,
  eco_temp numeric NOT NULL DEFAULT 19,
  night_temp numeric NOT NULL DEFAULT 18,
  preheat_hours numeric NOT NULL DEFAULT 2,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.heating_settings ENABLE ROW LEVEL SECURITY;

-- Create policy for public access
CREATE POLICY "Allow all operations on heating_settings" 
ON public.heating_settings 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Insert default settings
INSERT INTO public.heating_settings (pv_capacity_kwp, battery_capacity_kwh) 
VALUES (15.8, 13.8);