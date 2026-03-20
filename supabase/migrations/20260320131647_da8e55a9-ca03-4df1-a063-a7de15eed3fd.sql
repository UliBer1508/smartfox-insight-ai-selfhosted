-- Remove anonymous INSERT on energy_readings (collector will use service_role key)
DROP POLICY IF EXISTS "Allow anonymous insert for collector" ON public.energy_readings;