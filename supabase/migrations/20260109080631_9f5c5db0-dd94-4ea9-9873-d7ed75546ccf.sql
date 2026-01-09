-- Schritt 1: RLS auf allen Tabellen aktivieren
ALTER TABLE public.daily_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heating_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heating_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smartfox_settings ENABLE ROW LEVEL SECURITY;

-- Schritt 2: Alte unsichere Policies entfernen
DROP POLICY IF EXISTS "Allow all operations on consumer_logs" ON public.consumer_logs;
DROP POLICY IF EXISTS "Allow all access to data_retention_settings" ON public.data_retention_settings;
DROP POLICY IF EXISTS "Allow all operations on daily_patterns" ON public.daily_patterns;
DROP POLICY IF EXISTS "Allow all operations on detected_patterns" ON public.detected_patterns;
DROP POLICY IF EXISTS "Allow all operations on energy_daily_costs" ON public.energy_daily_costs;
DROP POLICY IF EXISTS "Allow all operations on energy_readings" ON public.energy_readings;
DROP POLICY IF EXISTS "Allow all operations on heating_recommendations" ON public.heating_recommendations;
DROP POLICY IF EXISTS "Allow all operations on heating_settings" ON public.heating_settings;
DROP POLICY IF EXISTS "Allow all operations on hourly_aggregates" ON public.hourly_aggregates;
DROP POLICY IF EXISTS "Allow all operations on learning_events" ON public.learning_events;
DROP POLICY IF EXISTS "Allow all operations on pv_forecasts" ON public.pv_forecasts;
DROP POLICY IF EXISTS "Allow all operations on room_heating_logs" ON public.room_heating_logs;
DROP POLICY IF EXISTS "Allow all operations on room_ml_features" ON public.room_ml_features;
DROP POLICY IF EXISTS "Allow all operations on room_recommendations" ON public.room_recommendations;
DROP POLICY IF EXISTS "Allow all operations on room_temperature_samples" ON public.room_temperature_samples;
DROP POLICY IF EXISTS "Allow all operations on rooms" ON public.rooms;
DROP POLICY IF EXISTS "Allow all operations on smartfox_settings" ON public.smartfox_settings;
DROP POLICY IF EXISTS "Allow all operations on weather_data" ON public.weather_data;

-- Schritt 3: Neue Policies für authentifizierte Benutzer
CREATE POLICY "Authenticated users full access" ON public.consumer_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.daily_patterns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.data_retention_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.detected_patterns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.energy_daily_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.energy_readings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.heating_recommendations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.heating_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.hourly_aggregates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.learning_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.pv_forecasts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.room_heating_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.room_ml_features FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.room_recommendations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.room_temperature_samples FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.rooms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.smartfox_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access" ON public.weather_data FOR ALL TO authenticated USING (true) WITH CHECK (true);