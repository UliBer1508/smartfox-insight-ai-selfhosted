-- Remove anonymous SELECT/UPDATE on rooms (exposes local_key, device IDs, IPs)
DROP POLICY IF EXISTS "Allow anonymous select for collector" ON public.rooms;
DROP POLICY IF EXISTS "Allow anonymous update for collector" ON public.rooms;

-- Remove anonymous SELECT/UPDATE on thermostat_commands
DROP POLICY IF EXISTS "Allow anonymous select for collector" ON public.thermostat_commands;
DROP POLICY IF EXISTS "Allow anonymous update for collector" ON public.thermostat_commands;

-- Fix system_settings: restrict INSERT/UPDATE to authenticated users
DROP POLICY IF EXISTS "Authenticated users can insert system settings" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated users can update system settings" ON public.system_settings;

CREATE POLICY "Authenticated users can insert system settings"
ON public.system_settings FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update system settings"
ON public.system_settings FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);