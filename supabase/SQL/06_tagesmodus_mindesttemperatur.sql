-- 06_tagesmodus_mindesttemperatur.sql
-- Konzept 27.10.2026 (doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md)
-- Neue Spalte rooms.wait_min_temp = "Mindesttemperatur ohne PV" je Raum.
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz ausführen (wiederholbar).
-- Muss VOR dem Deploy von pv-automation und VOR dem Frontend-Update laufen.

-- Der Schutz-Trigger auf rooms behandelt den SQL-Editor sonst wie anon.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

alter table public.rooms
  add column if not exists wait_min_temp numeric;

comment on column public.rooms.wait_min_temp is
  'Mindesttemperatur ohne PV (°C): Ziel am Wartetag, beim Batterie-Gate und für Räume ohne Budget. Leer = Eco − 1,5 °C. Konzept 27.10.2026.';

-- Startwerte: Eco − 1,5 °C (auf 0,5 abgerundet, mind. 5 °C). Danach in der App je Raum anpassen.
update public.rooms
set wait_min_temp = greatest(5, floor((coalesce(eco_temp, 19) - 1.5) * 2) / 2)
where wait_min_temp is null;

-- Max. Netz-Heizleistung: existiert seit 06.02.2026, Standard 2000 W.
update public.heating_settings
set max_grid_heating_power_w = 2000
where max_grid_heating_power_w is null;

-- Kontrolle
select name, priority, eco_temp, wait_min_temp, comfort_temp, night_temp
from public.rooms
order by priority;

select max_grid_heating_power_w from public.heating_settings limit 1;

-- Rückweg (nur falls nötig):
-- alter table public.rooms drop column if exists wait_min_temp;
