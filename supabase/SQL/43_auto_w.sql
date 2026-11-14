-- 43_auto_w.sql (14.11.2026) – doc/FIX-HEIZUNG-JETZT-AUTO-2026-11-14.md
-- Ladeleistung der Wallboxen neben PV/Netz/Batterie. Schreibt der Fronius-Collector (smartfox-collector) aus
-- Wallbox-Backend GET /api/state. Am 14.11.2026 durch Claude ausgeführt. Wiederholbar.
alter table public.energy_readings add column if not exists auto_w numeric;
comment on column public.energy_readings.auto_w is 'Ladeleistung beider Wallboxen (W) aus Wallbox-Backend /api/state, vom Fronius-Collector seit 14.11.2026. null = nicht gelesen.';
