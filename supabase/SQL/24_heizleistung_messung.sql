-- 24_heizleistung_messung.sql  (06.11.2026)
-- doc/FIX-HEIZLEISTUNG-2026-11-06.md – Uli: „wir haben keine Kontrolle über den Stromverbrauch der Heizung“,
-- entschieden „wir machen alle 4 Punkte“, Punkt 4: „Grenze gilt immer“.
--
--  1) raum_leistung_messung      – Ergebnis der nächtlichen Leistungsmessung je Raum (+ Grundlast)
--  2) raum_leistung_daten(tage)  – Messdaten für die Messung: je Fronius-Messwert ohne PV der Hausverbrauch
--                                  und je Raum „heizt“ (Mittel aus Thermostat-Abfrage davor und danach)
--  3) raum_heizung_heute()       – für die App: je Raum heizt seit, Heizminuten und kWh heute
--  4) Whitelist heating_power_w  – Vorschläge der Messung erscheinen in KI › Zu entscheiden, Uli genehmigt
--  5) heating_settings.cap_wait_boost_min – nach so vielen Minuten Warten kommt ein Raum zuerst dran (Grenze)
--
-- Im Supabase SQL-Editor ausführen (wiederholbar). Danach Edge Functions measure-room-power,
-- analysis-scheduler und pv-automation deployen (GitHub-Aktion nach dem Merge).

-- 1) Messergebnisse -----------------------------------------------------------------------------------------
create table if not exists public.raum_leistung_messung (
  id                 bigserial primary key,
  gemessen_at        timestamptz not null default now(),
  tage               int not null,                 -- Zeitraum der Messung
  room_id            uuid references public.rooms(id) on delete cascade,   -- null = Grundlast
  raum               text not null,
  watt               int,                          -- gemessene Leistung (null = keine Daten)
  punkte             int not null default 0,       -- Messwerte, in denen der Raum (teilweise) heizte
  voll_punkte        int not null default 0,       -- Messwerte, in denen er die ganzen 5 Minuten heizte
  eingestellt_w      int,                          -- rooms.heating_power_w zum Zeitpunkt der Messung
  sicherheit         text,                         -- hoch | mittel | gering | keine
  mittl_abweichung_w int                           -- wie gut die Rechnung den Verbrauch trifft (alle Räume)
);
comment on table public.raum_leistung_messung is
  'Leistungsmessung je Raum (06.11.2026): Hausverbrauch ohne PV gegen „heizt“ der Thermostate, täglich 09:30 (measure-room-power).';
create index if not exists raum_leistung_messung_at_idx on public.raum_leistung_messung (gemessen_at desc);
alter table public.raum_leistung_messung enable row level security;
drop policy if exists "Authenticated read" on public.raum_leistung_messung;
create policy "Authenticated read" on public.raum_leistung_messung for select to authenticated using (auth.uid() is not null);

-- 2) Messdaten -----------------------------------------------------------------------------------------------
-- Ein Wert statt Zeilen, damit die Abfrage nicht an der 1000-Zeilen-Grenze von PostgREST hängt.
-- Thermostate werden alle ~5 min abgefragt, der Fronius auch – aber versetzt. Deshalb je Raum das Mittel aus
-- der Abfrage davor und danach (0, 0,5 oder 1). Fehlt eine davon (> 7 min Abstand), ist der Wert null.
create or replace function public.raum_leistung_daten(p_tage int default 14)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with r as (
    select id, name, heating_power_w from rooms where tuya_device_id is not null order by name
  ),
  e as (
    select timestamp t, consumption c from energy_readings
    where timestamp > now() - make_interval(days => p_tage) and coalesce(pv_power, 0) < 30 and consumption is not null
  ),
  z as (
    select e.t, e.c,
      (select jsonb_agg(
         case when a.h is null and b.h is null then null
              else round(((coalesce(a.h,0) + coalesce(b.h,0))::numeric / ((a.h is not null)::int + (b.h is not null)::int)), 2) end
         order by r.name)
       from r
       left join lateral (select case when s.is_heating then 1 else 0 end h from room_temperature_samples s
                          where s.room_id = r.id and s.timestamp <= e.t and s.timestamp > e.t - interval '7 min'
                          order by s.timestamp desc limit 1) a on true
       left join lateral (select case when s.is_heating then 1 else 0 end h from room_temperature_samples s
                          where s.room_id = r.id and s.timestamp > e.t and s.timestamp < e.t + interval '7 min'
                          order by s.timestamp limit 1) b on true
      ) f
    from e
  )
  select jsonb_build_object(
    'rooms', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'heating_power_w', heating_power_w) order by name) from r),
    'rows',  coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from t)::bigint, round(c::numeric), f) order by t) from z), '[]'::jsonb)
  );
$$;
grant execute on function public.raum_leistung_daten(int) to service_role;

-- 3) Heizung heute je Raum (für die App) ------------------------------------------------------------------------
create or replace function public.raum_heizung_heute()
returns table (room_id uuid, heizt_seit timestamptz, heiz_min int, kwh numeric)
language sql stable security definer set search_path to 'public' as $$
  with tag as (select (date_trunc('day', now() at time zone 'Europe/Vienna') at time zone 'Europe/Vienna') as von),
  s as (
    select x.room_id, x.timestamp, x.is_heating,
           least(extract(epoch from coalesce(lead(x.timestamp) over w, now()) - x.timestamp), 900) as dt,
           lag(x.is_heating) over w as vorher
    from room_temperature_samples x, tag
    where x.timestamp >= tag.von - interval '6 hours'
    window w as (partition by x.room_id order by x.timestamp)
  ),
  letzt as (
    select distinct on (room_id) room_id, is_heating from s order by room_id, timestamp desc
  ),
  start as (   -- letzter Wechsel „aus → an“
    select room_id, max(timestamp) as ts from s where is_heating and coalesce(vorher, false) = false group by room_id
  )
  select r.id,
         case when l.is_heating then st.ts end,
         coalesce(round(sum(s.dt) filter (where s.is_heating and s.timestamp >= (select von from tag)) / 60.0), 0)::int,
         round((coalesce(sum(s.dt) filter (where s.is_heating and s.timestamp >= (select von from tag)), 0) / 3600.0
                * coalesce(r.calculated_power_w, r.heating_power_w, 800) / 1000.0)::numeric, 2)
  from rooms r
  left join s on s.room_id = r.id
  left join letzt l on l.room_id = r.id
  left join start st on st.room_id = r.id
  where r.tuya_device_id is not null
  group by r.id, r.calculated_power_w, r.heating_power_w, l.is_heating, st.ts;
$$;
grant execute on function public.raum_heizung_heute() to authenticated, service_role;

-- 4) Whitelist: Heizleistung je Raum darf vorgeschlagen werden (nur Vorschlag, Uli genehmigt) -----------------
insert into public.ai_parameter_whitelist (parameter_key, scope, storage_table, storage_column, data_type,
                                           min_value, max_value, autonomy_level, enabled, description)
select 'heating_power_w', 'room', 'rooms', 'heating_power_w', 'integer', 50, 8000, 'suggest', true,
       'Heizleistung je Raum (W) – gemessen aus Hausverbrauch und „heizt“ der Thermostate (measure-room-power)'
where not exists (select 1 from public.ai_parameter_whitelist where parameter_key = 'heating_power_w' and scope = 'room');

-- 5) Wartezeit-Vorrang an der Leistungsgrenze ---------------------------------------------------------------------
alter table public.heating_settings add column if not exists cap_wait_boost_min int not null default 60;
comment on column public.heating_settings.cap_wait_boost_min is
  'Leistungsgrenze (06.11.2026): Ein Raum, der so viele Minuten auf freie Leistung wartet, kommt zuerst dran. 0 = nur Priorität.';

-- Kontrolle
select jsonb_array_length(public.raum_leistung_daten(14) -> 'rows') as messwerte_ohne_pv;
select r.name, h.* from public.raum_heizung_heute() h join public.rooms r on r.id = h.room_id order by r.priority;
select parameter_key, scope, autonomy_level, enabled from public.ai_parameter_whitelist where parameter_key = 'heating_power_w';
