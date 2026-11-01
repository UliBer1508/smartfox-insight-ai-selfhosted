-- 12_batterie_schutz.sql  (01.11.2026)
-- Batterie-Schutz (Ladestand-Grenze) ohne Lücken – Konzept Tagesablauf §3.1/§3.4 (Stand 01.11.2026)
--  1. Neue Einstellwerte für das Notfall-Heizen im Batterie-Schutz
--  2. Protokoll-Auswertungen: Räume ohne eingetragene Leistung wie pv-automation mit
--     calculated_power_w bzw. 800 W rechnen (vorher 0 W → Haustür/Toilette Eingang fehlten)
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz komplett ausführen (wiederholbar).
-- Reihenfolge: dieses SQL → supabase functions deploy pv-automation → App (Vercel).

alter table public.heating_settings
  add column if not exists battery_gate_floor_delta numeric not null default 1.0,
  add column if not exists battery_gate_max_power_w integer not null default 1000;

comment on column public.heating_settings.battery_gate_floor_delta is
  'Batterie-Schutz: Räume werden erst unter „Untergrenze − dieser Abstand“ (°C) geheizt (Notfall). Standard 1,0.';
comment on column public.heating_settings.battery_gate_max_power_w is
  'Batterie-Schutz: höchstens so viel Heizleistung (W) für Notfall-Heizen gleichzeitig. Standard 1000.';

create or replace function public.protokoll_energie_stunden(p_tag date default (now() at time zone 'Europe/Vienna')::date)
returns table (stunde timestamptz, verbrauch_w numeric, heizung_w numeric, rest_w numeric, pv_w numeric, batt_w numeric, netz_w numeric, soc numeric)
language sql stable security definer set search_path to 'public' as $$
  with b as (select (p_tag::timestamp at time zone 'Europe/Vienna') as von, ((p_tag + 1)::timestamp at time zone 'Europe/Vienna') as bis),
  e as (
    select date_trunc('hour', timestamp) as hr, avg(consumption) as c, avg(pv_power) as pv,
           avg(greatest(battery_power, 0)) as batt, avg(greatest(power_io, 0)) as netz, avg(battery_soc) as soc
    from energy_readings, b where timestamp >= b.von and timestamp < b.bis group by 1
  ),
  s as (
    select room_id, date_trunc('hour', timestamp) as hr, count(*) filter (where is_heating)::numeric / count(*) as anteil
    from room_temperature_samples, b where timestamp >= b.von and timestamp < b.bis group by 1, 2
  ),
  h as (select s.hr, sum(s.anteil * coalesce(r.calculated_power_w, r.heating_power_w, 800)) as w from s join rooms r on r.id = s.room_id group by 1)
  select e.hr, round(e.c), round(coalesce(h.w, 0)), round(e.c - coalesce(h.w, 0)), round(e.pv), round(e.batt), round(e.netz), round(e.soc::numeric, 1)
  from e left join h using (hr) order by e.hr;
$$;

create or replace function public.protokoll_energie_raeume(p_tag date default (now() at time zone 'Europe/Vienna')::date)
returns table (room_id uuid, raum text, heiz_min numeric, kwh numeric, pv_kwh numeric, batt_kwh numeric, netz_kwh numeric)
language sql stable security definer set search_path to 'public' as $$
  with b as (select (p_tag::timestamp at time zone 'Europe/Vienna') as von, ((p_tag + 1)::timestamp at time zone 'Europe/Vienna') as bis),
  e as (
    select date_trunc('hour', timestamp) as hr, avg(consumption) as c,
           avg(greatest(battery_power, 0)) as batt, avg(greatest(power_io, 0)) as netz
    from energy_readings, b where timestamp >= b.von and timestamp < b.bis group by 1
  ),
  s as (
    select room_id, date_trunc('hour', timestamp) as hr, count(*) filter (where is_heating)::numeric / count(*) as anteil
    from room_temperature_samples, b where timestamp >= b.von and timestamp < b.bis group by 1, 2
  )
  select r.id, r.name,
         round(sum(s.anteil * 60)),
         round(sum(s.anteil * coalesce(r.calculated_power_w, r.heating_power_w, 800)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.calculated_power_w, r.heating_power_w, 800) * greatest(e.c - e.batt - e.netz, 0) / nullif(e.c, 0)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.calculated_power_w, r.heating_power_w, 800) * e.batt / nullif(e.c, 0)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.calculated_power_w, r.heating_power_w, 800) * e.netz / nullif(e.c, 0)) / 1000, 2)
  from s join rooms r on r.id = s.room_id join e using (hr)
  where s.anteil > 0
  group by r.id, r.name
  order by 4 desc;
$$;

-- Kontrolle
select heating_min_battery_soc, heating_soc_gate_mode, battery_gate_floor_delta, battery_gate_max_power_w, max_grid_heating_power_w
from public.heating_settings limit 1;
select raum, kwh, batt_kwh from public.protokoll_energie_raeume();
