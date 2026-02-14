
-- Allow anonymous SELECT on rooms for local collector
CREATE POLICY "Allow anonymous select for collector"
  ON public.rooms
  FOR SELECT
  USING (true);

-- Allow anonymous UPDATE on rooms for auto-discover script
CREATE POLICY "Allow anonymous update for collector"
  ON public.rooms
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow anonymous SELECT on thermostat_commands for collector
CREATE POLICY "Allow anonymous select for collector"
  ON public.thermostat_commands
  FOR SELECT
  USING (true);

-- Allow anonymous UPDATE on thermostat_commands for collector
CREATE POLICY "Allow anonymous update for collector"
  ON public.thermostat_commands
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
