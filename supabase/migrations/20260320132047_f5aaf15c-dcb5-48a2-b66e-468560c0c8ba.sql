-- Anon-Policies für den lokalen Collector (nutzt anon_key)

-- energy_readings: INSERT für Fronius-Messwerte
CREATE POLICY "Anon collector can insert energy readings"
ON public.energy_readings FOR INSERT TO anon
WITH CHECK (true);

-- rooms: SELECT + UPDATE für Thermostat-Sync
CREATE POLICY "Anon collector can read rooms"
ON public.rooms FOR SELECT TO anon
USING (true);

CREATE POLICY "Anon collector can update rooms"
ON public.rooms FOR UPDATE TO anon
USING (true) WITH CHECK (true);

-- thermostat_commands: SELECT + UPDATE für Command-Queue
CREATE POLICY "Anon collector can read commands"
ON public.thermostat_commands FOR SELECT TO anon
USING (true);

CREATE POLICY "Anon collector can update commands"
ON public.thermostat_commands FOR UPDATE TO anon
USING (true) WITH CHECK (true);

-- api_errors: INSERT + UPDATE für Fehler-Logging
CREATE POLICY "Anon collector can insert errors"
ON public.api_errors FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Anon collector can update errors"
ON public.api_errors FOR UPDATE TO anon
USING (true) WITH CHECK (true);

-- data_retention_settings: SELECT für Polling-Intervall
CREATE POLICY "Anon collector can read retention settings"
ON public.data_retention_settings FOR SELECT TO anon
USING (true);