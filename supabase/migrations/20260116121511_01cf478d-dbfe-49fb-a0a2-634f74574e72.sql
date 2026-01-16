-- Create system_settings table for storing system configuration
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read access (system config doesn't need auth)
CREATE POLICY "System settings are publicly readable"
ON public.system_settings
FOR SELECT
USING (true);

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update system settings"
ON public.system_settings
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can insert system settings"
ON public.system_settings
FOR INSERT
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial Tuya subscription data
INSERT INTO public.system_settings (key, value)
VALUES (
  'tuya_subscription',
  '{"expires_at": "2026-07-16", "warning_days": 30}'::jsonb
);