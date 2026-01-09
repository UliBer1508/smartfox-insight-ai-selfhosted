-- Erlaube anonymen INSERT für den Collector
CREATE POLICY "Allow anonymous insert for collector" 
ON public.energy_readings
FOR INSERT 
TO anon
WITH CHECK (true);