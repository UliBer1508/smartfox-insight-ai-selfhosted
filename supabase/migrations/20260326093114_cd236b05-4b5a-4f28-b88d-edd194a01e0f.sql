
-- Öffentliche SELECT-Policy von system_settings entfernen
DROP POLICY IF EXISTS "System settings are publicly readable" ON public.system_settings;

-- Stattdessen SELECT nur für authenticated
CREATE POLICY "Authenticated users can read system settings"
ON public.system_settings FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
