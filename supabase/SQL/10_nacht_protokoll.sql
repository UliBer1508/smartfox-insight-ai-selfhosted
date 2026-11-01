-- 10_nacht_protokoll.sql  (01.11.2026)
-- Nacht-Protokoll: Welche Nacht-Einstellung ist besser – Frostschutz 5 °C oder Nachtwert halten?
-- Je Nacht und Raum: Einstellungen (vor der Nacht gemerkt) + Ergebnis (am Morgen ausgewertet):
-- Temperatur abends/morgens/min, Heizminuten und kWh in der Nacht, Außentemperatur,
-- Batterie abends/morgens, Netzbezug in der Nacht.
-- Reines SQL, kein net.http_post, kein API-Schlüssel (Lehre: SQL-Cron ist am zuverlässigsten).
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz komplett ausführen (wiederholbar).

-- 1. Tabelle --------------------------------------------------------------------------
create table if not exists public.nacht_protokoll (
  nacht          date not null,                 -- Datum des Abends
  room_id        uuid not null,
  raum           text,
  modus          text,                          -- frost_only / maintain
  nacht_soll     numeric,                       -- wirksamer Nacht-Sollwert (frost_only = 5)
  untergrenze    numeric,
  eco            numeric,
  komfort        numeric,
  nacht_von      time,
  nacht_bis      time,
  quelle         text not null default 'cron',  -- cron / nachgetragen / hand
  temp_abends    numeric,
  temp_morgens   numeric,
  temp_min       numeric,
  heiz_min       numeric,                       -- Heizminuten in der Nacht (room_heating_logs)
  heiz_kwh       numeric,
  aussen_avg     numeric,
  aussen_min     numeric,
  soc_abends     numeric,                       -- Haus-Werte, je Zeile wiederholt
  soc_morgens    numeric,
  netz_kwh       numeric,
  ausgewertet_at timestamptz,
  created_at     timestamptz not null default now(),
  primary key (nacht, room_id)
);
comment on table public.nacht_protokoll is
  'Je Nacht und Raum: Nacht-Einstellung und Ergebnis (Konzept Tagesablauf, Test Nachtwert statt Frostschutz ab 01.11.2026).';

alter table public.nacht_protokoll enable row level security;
drop policy if exists "Authenticated read" on public.nacht_protokoll;
create policy "Authenticated read" on public.nacht_protokoll for select to authenticated using (auth.uid() is not null);

-- 2. Einstellungen vor der Nacht merken ------------------------------------------------
create or replace function public.nacht_einstellungen_merken(
  p_nacht date default (now() at time zone 'Europe/Vienna')::date,
  p_quelle text default 'cron',
  p_modus text default null                    -- nur für Nachtragen alter Nächte
) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  hs record;
  v_modus text;
  n integer;
begin
  select night_heating_mode, night_start_time, night_end_time into hs from heating_settings limit 1;
  v_modus := coalesce(p_modus, hs.night_heating_mode, 'frost_only');
  insert into nacht_protokoll (nacht, room_id, raum, modus, nacht_soll, untergrenze, eco, komfort, nacht_von, nacht_bis, quelle)
  select p_nacht, r.id, r.name, v_modus,
         case when v_modus = 'frost_only' then 5 else r.night_temp end,
         coalesce(r.wait_min_temp, r.eco_temp - 1.5), r.eco_temp, r.comfort_temp,
         coalesce(hs.night_start_time::time, '22:00'), coalesce(hs.night_end_time::time, '08:00'), p_quelle
  from rooms r
  on conflict (nacht, room_id) do update set
    raum = excluded.raum, modus = excluded.modus, nacht_soll = excluded.nacht_soll,
    untergrenze = excluded.untergrenze, eco = excluded.eco, komfort = excluded.komfort,
    nacht_von = excluded.nacht_von, nacht_bis = excluded.nacht_bis, quelle = excluded.quelle;
  get diagnostics n = row_count;
  return n;
end $$;

-- 3. Nacht am Morgen auswerten -----------------------------------------------------------
create or replace function public.nacht_auswerten(
  p_nacht date default ((now() at time zone 'Europe/Vienna')::date - 1)
) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_von time; v_bis time;
  ws timestamptz; we timestamptz;
  v_soc_a numeric; v_soc_m numeric; v_netz numeric; v_aussen numeric; v_aussen_min numeric;
  n integer;
begin
  select nacht_von, nacht_bis into v_von, v_bis from nacht_protokoll where nacht = p_nacht limit 1;
  if v_von is null then return 0; end if;
  ws := (p_nacht + v_von) at time zone 'Europe/Vienna';
  we := (p_nacht + 1 + v_bis) at time zone 'Europe/Vienna';

  -- Batterie und Netzbezug (Fronius: power_io > 0 = Bezug); Lücken > 15 min nicht hochrechnen
  select (array_agg(battery_soc order by timestamp))[1], (array_agg(battery_soc order by timestamp desc))[1]
    into v_soc_a, v_soc_m
  from energy_readings where timestamp >= ws and timestamp < we and battery_soc is not null;

  select round(sum(greatest(power_io, 0) * least(dt, 900)) / 3600000.0, 2) into v_netz
  from (select power_io, extract(epoch from lead(timestamp) over (order by timestamp) - timestamp) as dt
        from energy_readings where timestamp >= ws and timestamp < we) x
  where dt is not null;

  -- weather_data speichert Wiener Ortszeit als UTC
  select round(avg(temperature_c)::numeric, 1), round(min(temperature_c)::numeric, 1) into v_aussen, v_aussen_min
  from weather_data
  where (timestamp at time zone 'UTC') >= (p_nacht + v_von) and (timestamp at time zone 'UTC') < (p_nacht + 1 + v_bis);

  update nacht_protokoll np set
    temp_abends  = t.t_a,
    temp_morgens = t.t_m,
    temp_min     = t.t_min,
    heiz_min     = coalesce(h.minuten, 0),
    heiz_kwh     = coalesce(h.kwh, 0),
    aussen_avg   = v_aussen,
    aussen_min   = v_aussen_min,
    soc_abends   = v_soc_a,
    soc_morgens  = v_soc_m,
    netz_kwh     = v_netz,
    ausgewertet_at = now()
  from nacht_protokoll p
  left join lateral (
    select (array_agg(temperature order by timestamp))[1] as t_a,
           (array_agg(temperature order by timestamp desc))[1] as t_m,
           min(temperature) as t_min
    from room_temperature_samples s
    where s.room_id = p.room_id and s.timestamp >= ws and s.timestamp < we
  ) t on true
  left join lateral (
    select sum(duration_minutes) as minuten, round(sum(energy_estimate_wh) / 1000.0, 2) as kwh
    from room_heating_logs l
    where l.room_id = p.room_id and l.event_type = 'heating_stop' and l.timestamp > ws and l.timestamp <= we
  ) h on true
  where np.nacht = p_nacht and p.nacht = np.nacht and p.room_id = np.room_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- 4. Stündlicher Takt, entscheidet selbst nach Wiener Ortszeit (Sommer-/Winterzeit egal)
create or replace function public.nacht_protokoll_tick() returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_local timestamp := now() at time zone 'Europe/Vienna';
begin
  if extract(hour from v_local) = 21 then perform nacht_einstellungen_merken(v_local::date); end if;
  if extract(hour from v_local) = 9  then perform nacht_auswerten(v_local::date - 1); end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'nacht-protokoll';
select cron.schedule('nacht-protokoll', '55 * * * *', $$select public.nacht_protokoll_tick();$$);

-- 5. Vergleichsbasis: Frostschutz-Nächte seit 26.10. nachtragen (Heizzyklen erst seit 26.10. sauber).
--    Raumwerte sind die heutigen (alte nicht gespeichert), Modus war frost_only.
do $$
declare d date;
begin
  for d in select generate_series('2026-10-26'::date, (now() at time zone 'Europe/Vienna')::date - 1, '1 day')::date loop
    if not exists (select 1 from nacht_protokoll where nacht = d and quelle = 'cron') then
      perform nacht_einstellungen_merken(d, 'nachgetragen', 'frost_only');
    end if;
    perform nacht_auswerten(d);
  end loop;
end $$;

-- Kontrolle
select command from cron.job where jobname = 'nacht-protokoll';
select nacht, modus, count(*) as raeume, max(soc_abends) as soc_abends, max(soc_morgens) as soc_morgens,
       max(netz_kwh) as netz_kwh, sum(heiz_kwh) as heiz_kwh, max(aussen_avg) as aussen
from nacht_protokoll group by nacht, modus order by nacht;

-- Rückweg (nur falls nötig):
-- select cron.unschedule('nacht-protokoll');
-- drop function if exists public.nacht_protokoll_tick(), public.nacht_auswerten(date), public.nacht_einstellungen_merken(date, text, text);
-- drop table if exists public.nacht_protokoll;
