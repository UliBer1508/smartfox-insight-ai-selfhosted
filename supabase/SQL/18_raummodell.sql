-- 18_raummodell.sql  (02.11.2026)
-- Raummodell: Wie schnell kühlt jeder Raum bei welcher Außentemperatur aus?
-- Konzept: doc/KONZEPT-RAUMMODELL-2026-11-02.md
--
-- Physik (Newton): T(t) = T_außen + (T_start − T_außen) · e^(−k·t)
--   k [1/h] je Raum, gemessen in Nächten OHNE Heizen:  k = ln((T_abends − T_außen) / (T_morgens − T_außen)) / Stunden
-- Damit gilt für jede Außentemperatur: Abfall in h Stunden = (T − T_außen) · (1 − e^(−k·h)).
-- Winter und Sommer unterscheiden sich nur in T_außen – k bleibt eine Eigenschaft des Raums (Estrich, Fenster, Lage).
--
-- Nächte mit Heizen werden erkannt und nicht verwendet:
--   * is_heating in room_temperature_samples (zuverlässig seit Thermostat-Dienst v1.3, 24.10.2026) oder
--   * heating_start in room_heating_logs oder
--   * Temperatur steigt in der Nacht um mehr als 0,3 °C über den bisherigen Tiefstwert (gilt auch für alte Daten).
-- Für Entscheidungen nimmt die Steuerung das 75-%-Quantil von k (vorsichtig: lieber zu schnelles Auskühlen annehmen).
--
-- Im SQL-Editor ausführen (Projekt pflnniklvqbwjwrjswaz). Danach in der App: Protokoll › Raummodell ›
-- „Außentemperaturen nachtragen und neu berechnen“.

create table if not exists public.raum_abkuehlung (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  nacht       date not null,              -- Datum des Nachtbeginns
  t_abends    numeric,                    -- Mittel der ersten 30 min
  t_morgens   numeric,                    -- Mittel der letzten 30 min
  t_min       numeric,
  aussen_avg  numeric,
  stunden     numeric,
  k_pro_h     numeric,                    -- null, wenn nicht verwendbar
  geheizt     boolean not null default false,
  gueltig     boolean not null default false,
  grund       text,                       -- warum (nicht) verwendet
  messwerte   int,
  berechnet_at timestamptz not null default now(),
  primary key (room_id, nacht)
);
comment on table public.raum_abkuehlung is 'Raummodell (02.11.2026): Abkühlung je Raum und Nacht ohne Heizen, Grundlage für k je Raum.';
alter table public.raum_abkuehlung enable row level security;
drop policy if exists "Authenticated read" on public.raum_abkuehlung;
create policy "Authenticated read" on public.raum_abkuehlung for select to authenticated using (auth.uid() is not null);

create index if not exists room_temperature_samples_room_ts_idx on public.room_temperature_samples (room_id, timestamp);

-- Eine Nacht für alle Räume berechnen
create or replace function public.raum_abkuehlung_nacht(p_nacht date)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_start int; v_end int;
  n_von timestamptz; n_bis timestamptz;
  l_von timestamp; l_bis timestamp;
  v_aussen numeric;
  v_count int := 0;
begin
  select coalesce(extract(hour from night_start_time::time), 22), coalesce(extract(hour from night_end_time::time), 8)
    into v_start, v_end from heating_settings limit 1;
  l_von := p_nacht + make_interval(hours => v_start);
  l_bis := p_nacht + 1 + make_interval(hours => v_end);
  n_von := l_von at time zone 'Europe/Vienna';
  n_bis := l_bis at time zone 'Europe/Vienna';

  -- weather_data speichert Wiener Ortszeit als UTC
  select avg(temperature_c) into v_aussen from weather_data
   where (timestamp at time zone 'UTC') >= l_von and (timestamp at time zone 'UTC') < l_bis;

  with s as (
    select s.room_id, s.timestamp, s.temperature, coalesce(s.is_heating, false) as h,
           min(s.temperature) over (partition by s.room_id order by s.timestamp rows between unbounded preceding and current row) as tiefst
    from room_temperature_samples s
    where s.timestamp >= n_von and s.timestamp < n_bis and s.temperature between 0 and 40
  ), agg as (
    select room_id,
           count(*) as n,
           avg(temperature) filter (where timestamp < n_von + interval '30 minutes') as ta,
           avg(temperature) filter (where timestamp >= n_bis - interval '30 minutes') as tm,
           min(temperature) as tmin,
           -- Zeitpunkte = Mitte der Mittelungsfenster, damit k nicht verzerrt wird
           to_timestamp(avg(extract(epoch from timestamp)) filter (where timestamp < n_von + interval '30 minutes')) as t0,
           to_timestamp(avg(extract(epoch from timestamp)) filter (where timestamp >= n_bis - interval '30 minutes')) as t1,
           bool_or(h) as heiz_flag,
           max(temperature - tiefst) as anstieg
    from s group by room_id
  ), logs as (
    select distinct l.room_id from room_heating_logs l
    where l.timestamp >= n_von and l.timestamp < n_bis and l.event_type = 'heating_start'
  ), r as (
    select a.*, (lg.room_id is not null) as heiz_log,
           extract(epoch from a.t1 - a.t0) / 3600.0 as std
    from agg a left join logs lg on lg.room_id = a.room_id
  )
  insert into raum_abkuehlung (room_id, nacht, t_abends, t_morgens, t_min, aussen_avg, stunden, k_pro_h, geheizt, gueltig, grund, messwerte, berechnet_at)
  select room_id, p_nacht, round(ta, 2), round(tm, 2), round(tmin, 2), round(v_aussen, 1), round(std::numeric, 2),
         case when ok then round(ln((ta - v_aussen) / (tm - v_aussen)) / std, 5) end,
         geheizt, ok, grund, n::int, now()
  from (
    select r.*,
           (heiz_flag or heiz_log or anstieg > 0.3) as geheizt,
           case
             when v_aussen is null then 'keine Außentemperatur'
             when n < 12 or ta is null or tm is null then 'zu wenige Messwerte'
             when heiz_flag or heiz_log then 'geheizt (Thermostat/Heizprotokoll)'
             when anstieg > 0.3 then 'geheizt (Temperatur stieg um ' || round(anstieg, 1) || ' °C)'
             when std is null or std < 6 then 'Nacht zu kurz gemessen'
             when ta - v_aussen < 3 or tm - v_aussen < 1 then 'zu warm draußen (Abstand < 3 °C)'
             when tm >= ta then 'kein Abfall'
             else 'ok'
           end as grund,
           (v_aussen is not null and n >= 12 and ta is not null and tm is not null and not (heiz_flag or heiz_log)
            and anstieg <= 0.3 and coalesce(std, 0) >= 6 and ta - v_aussen >= 3 and tm - v_aussen >= 1 and tm < ta) as ok
    from r
  ) x
  on conflict (room_id, nacht) do update set
    t_abends = excluded.t_abends, t_morgens = excluded.t_morgens, t_min = excluded.t_min, aussen_avg = excluded.aussen_avg,
    stunden = excluded.stunden, k_pro_h = excluded.k_pro_h, geheizt = excluded.geheizt, gueltig = excluded.gueltig,
    grund = excluded.grund, messwerte = excluded.messwerte, berechnet_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Mehrere Nächte (für die App: in Blöcken aufrufen, damit kein Zeitlimit greift)
create or replace function public.raum_modell_neu_berechnen(p_von date default null, p_bis date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_von date := p_von;
  v_bis date := coalesce(p_bis, (now() at time zone 'Europe/Vienna')::date - 1);
  d date; n int := 0; r int := 0;
begin
  if v_von is null then
    select (min(timestamp) at time zone 'Europe/Vienna')::date into v_von from room_temperature_samples;
  end if;
  if v_von is null then return jsonb_build_object('naechte', 0, 'zeilen', 0); end if;
  for d in select generate_series(v_von, v_bis, '1 day')::date loop
    r := r + raum_abkuehlung_nacht(d);
    n := n + 1;
  end loop;
  return jsonb_build_object('von', v_von, 'bis', v_bis, 'naechte', n, 'zeilen', r);
end $$;
grant execute on function public.raum_modell_neu_berechnen(date, date) to authenticated;

-- Erster Tag mit Raumtemperaturen (für den Nachtrag)
create or replace function public.raum_modell_erster_tag()
returns date language sql security definer set search_path to 'public' as $$
  select (min(timestamp) at time zone 'Europe/Vienna')::date from room_temperature_samples;
$$;
grant execute on function public.raum_modell_erster_tag() to authenticated;

-- Kennzahl je Raum (letzte 120 Nächte)
create or replace view public.raum_modell with (security_invoker = true) as
select r.id as room_id, r.name, r.priority, r.eco_temp, r.wait_min_temp,
       count(a.*) filter (where a.gueltig)                                             as naechte,
       count(a.*)                                                                       as naechte_gesamt,
       round(percentile_cont(0.5)  within group (order by a.k_pro_h) filter (where a.gueltig)::numeric, 5) as k_median,
       round(percentile_cont(0.75) within group (order by a.k_pro_h) filter (where a.gueltig)::numeric, 5) as k_vorsichtig,
       round(min(a.aussen_avg) filter (where a.gueltig), 1)                             as aussen_min,
       round(max(a.aussen_avg) filter (where a.gueltig), 1)                             as aussen_max,
       max(a.nacht) filter (where a.gueltig)                                            as letzte_nacht
from public.rooms r
left join public.raum_abkuehlung a on a.room_id = r.id and a.nacht >= (now() at time zone 'Europe/Vienna')::date - 120
group by r.id, r.name, r.priority, r.eco_temp, r.wait_min_temp;
grant select on public.raum_modell to authenticated;

-- Takt: im bestehenden nacht-protokoll-Cron, morgens 09:55 zusätzlich die letzte Nacht berechnen
create or replace function public.nacht_protokoll_tick() returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_local timestamp := now() at time zone 'Europe/Vienna';
begin
  if extract(hour from v_local) = 21 then
    perform nacht_einstellungen_merken(v_local::date);
    perform tag_einstellungen_merken(v_local::date);
  end if;
  if extract(hour from v_local) = 9 then
    perform nacht_auswerten(v_local::date - 1);
    perform tag_bewerten(v_local::date - 1);
    begin
      perform raum_abkuehlung_nacht(v_local::date - 1);
    exception when others then
      perform protokoll_add('fehler', null, 'Raummodell: Nacht nicht berechnet', sqlerrm, jsonb_build_object('nacht', v_local::date - 1));
    end;
  end if;
end $$;

-- Prüfen (nach dem Nachtrag in der App)
-- select * from public.raum_modell order by priority;
-- select nacht, count(*) filter (where gueltig) as gueltig, string_agg(distinct grund, ', ') from public.raum_abkuehlung group by nacht order by nacht desc;
