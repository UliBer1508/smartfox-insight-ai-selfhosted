-- 11_protokoll_modul.sql  (01.11.2026)
-- Test- und Protokoll-Modul (Konzept: doc/PROTOKOLL-MODUL-2026-11-01.md)
--
--  1. protokoll_events      – EIN Ereignis-Protokoll für alles: Sollwerte (mit Begründung), heizt an/aus,
--                             Tagesmodus, Einstellungen (alt → neu), Anwesenheit, Thermostat, Fehler.
--                             Gefüllt ausschließlich durch Datenbank-Trigger → wirkt für jeden Schreiber.
--  2. thermostat_state      – letzter Stand ALLER Datenpunkte je Thermostat (vom Dienst v1.4 geschrieben).
--     thermostat_dp_log     – jede Änderung eines Datenpunkts (außer Ist-Temperatur).
--     thermostat_state_upsert(...) – RPC für den Dienst (security definer, Dienst nutzt ggf. anon-Schlüssel).
--  3. thermostat_commands.reason – Begründung je Befehl (pv-automation); neue Befehle read_now, set_dp.
--  4. Auswertungen für die App: protokoll_schaltpunkte(), protokoll_energie_stunden(), protokoll_energie_raeume().
--
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz KOMPLETT ausführen (wiederholbar).
-- Lehren beachtet: RLS + Policy sofort; Trigger brechen nie den eigentlichen Schreibvorgang ab;
-- reines SQL ohne API-Schlüssel.

-- =====================================================================================
-- 1. Ereignis-Protokoll
-- =====================================================================================
create table if not exists public.protokoll_events (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  kind     text not null,      -- sollwert | heizt | modus | einstellung | anwesenheit | thermostat | fehler
  room_id  uuid,
  raum     text,
  title    text not null,
  detail   text,
  data     jsonb
);
create index if not exists protokoll_events_ts_idx on public.protokoll_events (ts desc);
create index if not exists protokoll_events_room_idx on public.protokoll_events (room_id, ts desc);
comment on table public.protokoll_events is 'Protokoll-Modul (01.11.2026): alle Ereignisse der Heizung, gefüllt durch Trigger.';

alter table public.protokoll_events enable row level security;
drop policy if exists "Authenticated read" on public.protokoll_events;
create policy "Authenticated read" on public.protokoll_events for select to authenticated using (auth.uid() is not null);

create or replace function public.protokoll_add(p_kind text, p_room uuid, p_title text, p_detail text default null, p_data jsonb default null, p_ts timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into protokoll_events (ts, kind, room_id, raum, title, detail, data)
  values (coalesce(p_ts, now()), p_kind, p_room, (select name from rooms where id = p_room), p_title, p_detail, p_data);
exception when others then
  raise warning 'protokoll_add: %', sqlerrm;
end $$;

create or replace function public.fmt_t(v numeric) returns text language sql immutable as $$
  select case when v is null then '–' else replace(to_char(v, 'FM990.0'), '.', ',') || ' °C' end
$$;

-- -------------------------------------------------------------------------------------
-- 1a. Sollwerte: beim Ausführen bzw. Scheitern eines Befehls. Wiederholte gleiche Werte nicht doppelt.
-- -------------------------------------------------------------------------------------
alter table public.thermostat_commands add column if not exists reason text;
comment on column public.thermostat_commands.reason is 'Begründung der Steuerung (pv-automation, App) – erscheint im Protokoll.';

create or replace function public.trg_protokoll_command() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_prev numeric;
begin
  if new.status is not distinct from old.status or new.status not in ('executed', 'failed') then return new; end if;

  if new.command = 'set_temp' then
    if new.status = 'executed' then
      select value into v_prev from thermostat_commands
       where room_id = new.room_id and command = 'set_temp' and status = 'executed' and id <> new.id
         and executed_at < coalesce(new.executed_at, now())
       order by executed_at desc limit 1;
      if v_prev is not null and abs(v_prev - new.value) < 0.05 then return new; end if;  -- gleicher Wert erneut
      perform protokoll_add('sollwert', new.room_id, '→ ' || fmt_t(new.value) || coalesce(' (vorher ' || fmt_t(v_prev) || ')', ''),
        new.reason, jsonb_build_object('soll', new.value, 'vorher', v_prev, 'status', new.status), coalesce(new.executed_at, now()));
    else
      perform protokoll_add('fehler', new.room_id, 'Sollwert ' || fmt_t(new.value) || ' nicht gesetzt',
        coalesce(new.error_message, '') || coalesce(' · ' || new.reason, ''), jsonb_build_object('soll', new.value), coalesce(new.executed_at, now()));
    end if;
  elsif new.command = 'set_dp' then
    perform protokoll_add(case when new.status = 'executed' then 'thermostat' else 'fehler' end, new.room_id,
      'Datenpunkt ' || coalesce(new.value_text, '?') || ' → ' || coalesce(new.value::text, '?') || case when new.status = 'executed' then ' gesetzt' else ' nicht gesetzt' end,
      coalesce(new.error_message, new.reason), jsonb_build_object('dp', new.value_text, 'wert', new.value), coalesce(new.executed_at, now()));
  elsif new.status = 'failed' then
    perform protokoll_add('fehler', new.room_id, 'Befehl ' || new.command || ' fehlgeschlagen', new.error_message, null, coalesce(new.executed_at, now()));
  end if;
  return new;
exception when others then
  raise warning 'trg_protokoll_command: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_command on public.thermostat_commands;
create trigger trg_protokoll_command after update of status on public.thermostat_commands
  for each row execute function public.trg_protokoll_command();

-- -------------------------------------------------------------------------------------
-- 1b. Heizt an / aus (room_heating_logs wird von Trigger 04 geschrieben)
-- -------------------------------------------------------------------------------------
create or replace function public.trg_protokoll_heizt() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.event_type = 'heating_start' then
    perform protokoll_add('heizt', new.room_id, 'heizt an',
      'Ist ' || fmt_t(new.current_temp) || ' · Soll ' || fmt_t(new.target_temp)
        || case when new.current_temp > new.target_temp + 0.2 then ' · über Soll' else '' end,
      jsonb_build_object('an', true, 'ist', new.current_temp, 'soll', new.target_temp), new."timestamp");
  elsif new.event_type = 'heating_stop' then
    perform protokoll_add('heizt', new.room_id, 'heizt aus',
      'Ist ' || fmt_t(new.current_temp) || ' · Soll ' || fmt_t(new.target_temp)
        || coalesce(' · ' || new.duration_minutes || ' min', '')
        || coalesce(' · ' || replace(to_char(new.energy_estimate_wh / 1000.0, 'FM990.00'), '.', ',') || ' kWh', ''),
      jsonb_build_object('an', false, 'ist', new.current_temp, 'soll', new.target_temp, 'min', new.duration_minutes, 'wh', new.energy_estimate_wh), new."timestamp");
  end if;
  return new;
exception when others then
  raise warning 'trg_protokoll_heizt: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_heizt on public.room_heating_logs;
create trigger trg_protokoll_heizt after insert on public.room_heating_logs
  for each row execute function public.trg_protokoll_heizt();

-- -------------------------------------------------------------------------------------
-- 1c. Tagesmodus-Wechsel (system_settings.heating_day_mode, alle 5 min von pv-automation geschrieben)
-- -------------------------------------------------------------------------------------
create or replace function public.trg_protokoll_modus() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_old text; v_new text; v_away_old text; v_away_new text;
  v_label text;
begin
  if new.key <> 'heating_day_mode' then return new; end if;
  v_new := new.value->>'mode';
  v_away_new := coalesce(new.value->>'away', 'false');
  if tg_op = 'UPDATE' then
    v_old := old.value->>'mode';
    v_away_old := coalesce(old.value->>'away', 'false');
    if v_old is not distinct from v_new and v_away_old = v_away_new then return new; end if;
  end if;
  v_label := case v_new when 'wait' then 'Wartetag' when 'grid' then 'ohne PV-Überschuss'
                        when 'battery_gate' then 'Batterie-Schutz' else coalesce(v_new, '?') end
             || case when v_away_new = 'true' then ' · abwesend' else '' end;
  perform protokoll_add('modus', null,
    coalesce(case v_old when 'wait' then 'Wartetag' when 'grid' then 'ohne PV-Überschuss' when 'battery_gate' then 'Batterie-Schutz' else v_old end, 'Start') || ' → ' || v_label,
    concat_ws(' · ',
      'Netz ' || coalesce(new.value->>'grid_used_w', '0') || '/' || coalesce(new.value->>'grid_cap_w', '?') || ' W',
      case when new.value->>'ratio' is not null then 'PV-Verhältnis ' || replace(round((new.value->>'ratio')::numeric, 2)::text, '.', ',') || ' (Schwelle ' || (new.value->>'threshold') || ')' end,
      nullif(new.value->>'ki_info', 'kein Muster'),
      new.value->>'presence_reason'),
    jsonb_build_object('mode', v_new, 'vorher', v_old, 'away', v_away_new));
  return new;
exception when others then
  raise warning 'trg_protokoll_modus: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_modus on public.system_settings;
create trigger trg_protokoll_modus after insert or update of value on public.system_settings
  for each row execute function public.trg_protokoll_modus();

-- -------------------------------------------------------------------------------------
-- 1d. Einstellungen: Räume (Grundwerte, Übersteuern) und Haus (heating_settings, alle Spalten)
-- -------------------------------------------------------------------------------------
create or replace function public.trg_protokoll_raum() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  k text; teile text[] := '{}';
  labels jsonb := '{"eco_temp":"Eco","comfort_temp":"Komfort","night_temp":"Nacht","wait_min_temp":"Untergrenze",
                    "priority":"Priorität","heating_power_w":"Leistung W","automation_enabled":"Automatik",
                    "pv_boost_max_temp":"Batterie-voll-Grenze","pv_auto_enabled":"PV-Automatik","name":"Name"}';
begin
  for k in select jsonb_object_keys(labels) loop
    if o->k is distinct from n->k then
      teile := teile || ((labels->>k) || ' ' || coalesce(o->>k, '–') || ' → ' || coalesce(n->>k, '–'));
    end if;
  end loop;
  if array_length(teile, 1) > 0 then
    perform protokoll_add('einstellung', new.id, array_to_string(teile, ' · '), 'Einstellungen › Räume',
      jsonb_build_object('alt', o - 'local_key', 'neu', n - 'local_key'));
  end if;
  if old.manual_override_until is distinct from new.manual_override_until then
    if new.manual_override_until is not null and new.manual_override_until > now() then
      perform protokoll_add('einstellung', new.id,
        'manuell ' || fmt_t(new.target_temp) || ' bis ' || to_char(new.manual_override_until at time zone 'Europe/Vienna', 'HH24:MI'),
        'Übersteuern', jsonb_build_object('bis', new.manual_override_until));
    elsif old.manual_override_until is not null and old.manual_override_until > now() then
      perform protokoll_add('einstellung', new.id, 'manuell beendet', 'Automatik übernimmt wieder', null);
    end if;
  end if;
  return new;
exception when others then
  raise warning 'trg_protokoll_raum: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_raum on public.rooms;
create trigger trg_protokoll_raum after update on public.rooms
  for each row execute function public.trg_protokoll_raum();

create or replace function public.trg_protokoll_haus() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  k text; teile text[] := '{}';
begin
  for k in select jsonb_object_keys(n) loop
    continue when k in ('id', 'updated_at', 'created_at');
    if o->k is distinct from n->k then
      teile := teile || (k || ' ' || coalesce(o->>k, '–') || ' → ' || coalesce(n->>k, '–'));
    end if;
  end loop;
  if array_length(teile, 1) > 0 then
    perform protokoll_add('einstellung', null, 'Haus: ' || array_to_string(teile, ' · '), 'Einstellungen › Haus', null);
  end if;
  return new;
exception when others then
  raise warning 'trg_protokoll_haus: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_haus on public.heating_settings;
create trigger trg_protokoll_haus after update on public.heating_settings
  for each row execute function public.trg_protokoll_haus();

-- -------------------------------------------------------------------------------------
-- 1e. Anwesenheit (presence_periods = Abwesenheiten seit 01.11.2026)
-- -------------------------------------------------------------------------------------
create or replace function public.trg_protokoll_anwesenheit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_txt text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  v_txt := to_char(r.start_at at time zone 'Europe/Vienna', 'DD.MM. HH24:MI') || ' – ' || to_char(r.end_at at time zone 'Europe/Vienna', 'DD.MM. HH24:MI');
  perform protokoll_add('anwesenheit', null,
    case tg_op when 'INSERT' then 'Abwesenheit eingetragen ' when 'UPDATE' then 'Abwesenheit geändert ' else 'Abwesenheit gelöscht ' end || v_txt,
    concat_ws(' · ', r.note, r.source), null);
  return r;
exception when others then
  raise warning 'trg_protokoll_anwesenheit: %', sqlerrm; return r;
end $$;

drop trigger if exists trg_protokoll_anwesenheit on public.presence_periods;
create trigger trg_protokoll_anwesenheit after insert or update or delete on public.presence_periods
  for each row execute function public.trg_protokoll_anwesenheit();

-- -------------------------------------------------------------------------------------
-- 1f. Fehler (api_errors, nur neue Einträge; Trigger 05 entdoppelt bereits)
-- -------------------------------------------------------------------------------------
create or replace function public.trg_protokoll_fehler() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform protokoll_add('fehler', new.room_id, coalesce(new.room_name || ': ', '') || new.error_type,
    new.error_message, jsonb_build_object('source', new.source), new.created_at);
  return new;
exception when others then
  raise warning 'trg_protokoll_fehler: %', sqlerrm; return new;
end $$;

drop trigger if exists trg_protokoll_fehler on public.api_errors;
create trigger trg_protokoll_fehler after insert on public.api_errors
  for each row execute function public.trg_protokoll_fehler();

-- =====================================================================================
-- 2. Thermostat-Zustand mit allen Datenpunkten
-- =====================================================================================
create table if not exists public.thermostat_state (
  room_id      uuid primary key,
  raum         text,
  read_at      timestamptz not null default now(),
  dps          jsonb not null,
  power_on     boolean,
  mode         text,
  soll         numeric,
  ist          numeric,
  heizt        boolean,
  dp101        numeric,     -- Bedeutung unklar (Schaltdifferenz?) – Rohwert
  korrektur    numeric,     -- DP 19 / 10 (Temperatur-Korrektur?)
  fuehler      text,        -- DP 106
  befund       text         -- z. B. 'heizt über Soll', 'Modus auto', 'Sollwert weicht ab'
);
comment on table public.thermostat_state is 'Protokoll-Modul: letzter Stand aller Datenpunkte je Thermostat (Dienst v1.4).';
alter table public.thermostat_state enable row level security;
drop policy if exists "Authenticated read" on public.thermostat_state;
create policy "Authenticated read" on public.thermostat_state for select to authenticated using (auth.uid() is not null);

create table if not exists public.thermostat_dp_log (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  room_id  uuid not null,
  dp       text not null,
  alt      jsonb,
  neu      jsonb
);
create index if not exists thermostat_dp_log_idx on public.thermostat_dp_log (room_id, ts desc);
alter table public.thermostat_dp_log enable row level security;
drop policy if exists "Authenticated read" on public.thermostat_dp_log;
create policy "Authenticated read" on public.thermostat_dp_log for select to authenticated using (auth.uid() is not null);

-- Vom Dienst nach jedem Auslesen aufgerufen. Speichert Stand, protokolliert geänderte Datenpunkte
-- (nicht DP 3 Ist-Temperatur, nicht DP 5 heizt – das läuft über rooms/room_heating_logs) und erkennt Auffälligkeiten.
create or replace function public.thermostat_state_upsert(p_room_id uuid, p_dps jsonb)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_old  jsonb;
  v_old_befund text;
  k      text;
  v_soll numeric := round((p_dps->>'2')::numeric / 10, 1);
  v_ist  numeric := round((p_dps->>'3')::numeric / 10, 1);
  v_heizt boolean := (p_dps->>'5') = '1';
  v_mode text := p_dps->>'4';
  v_cmd  numeric;
  v_cmd_at timestamptz;
  v_befund text[] := '{}';
  v_txt text;
begin
  if not exists (select 1 from rooms where id = p_room_id) then return 'unbekannter Raum'; end if;
  select dps, befund into v_old, v_old_befund from thermostat_state where room_id = p_room_id;

  -- geänderte Datenpunkte protokollieren
  if v_old is not null then
    for k in select jsonb_object_keys(p_dps) loop
      continue when k in ('3', '5');
      if v_old->k is distinct from p_dps->k then
        insert into thermostat_dp_log (room_id, dp, alt, neu) values (p_room_id, k, v_old->k, p_dps->k);
        if k not in ('2') then  -- Sollwert läuft über Befehle; hier nur Geräte-Einstellungen
          perform protokoll_add('thermostat', p_room_id, 'Datenpunkt ' || k || ': ' || coalesce(v_old->>k, '–') || ' → ' || coalesce(p_dps->>k, '–'),
            'am Gerät gelesen', jsonb_build_object('dp', k, 'alt', v_old->k, 'neu', p_dps->k));
        end if;
      end if;
    end loop;
  end if;

  -- Auffälligkeiten
  if v_mode is not null and v_mode <> 'home' then v_befund := v_befund || ('Modus ' || v_mode); end if;
  if (p_dps->>'1') = 'false' then v_befund := v_befund || 'ausgeschaltet'::text; end if;
  select value, executed_at into v_cmd, v_cmd_at from thermostat_commands
   where room_id = p_room_id and command = 'set_temp' and status = 'executed'
   order by executed_at desc limit 1;
  if v_cmd is not null and v_cmd_at < now() - interval '3 minutes' and abs(v_cmd - v_soll) >= 0.25 then
    v_befund := v_befund || ('Sollwert am Gerät ' || fmt_t(v_soll) || ', geschickt ' || fmt_t(v_cmd));
  end if;
  if v_heizt and v_ist > v_soll + 0.3 then v_befund := v_befund || 'heizt über Soll'::text; end if;

  v_txt := nullif(array_to_string(v_befund, ' · '), '');
  if v_txt is not null and v_txt is distinct from v_old_befund then
    perform protokoll_add('thermostat', p_room_id, v_txt,
      'Ist ' || fmt_t(v_ist) || ' · Soll ' || fmt_t(v_soll) || ' · heizt ' || case when v_heizt then 'ja' else 'nein' end,
      jsonb_build_object('ist', v_ist, 'soll', v_soll, 'heizt', v_heizt, 'mode', v_mode));
  end if;

  insert into thermostat_state (room_id, raum, read_at, dps, power_on, mode, soll, ist, heizt, dp101, korrektur, fuehler, befund)
  values (p_room_id, (select name from rooms where id = p_room_id), now(), p_dps, (p_dps->>'1')::boolean, v_mode, v_soll, v_ist, v_heizt,
          (p_dps->>'101')::numeric, round((p_dps->>'19')::numeric / 10, 1), p_dps->>'106', v_txt)
  on conflict (room_id) do update set raum = excluded.raum, read_at = excluded.read_at, dps = excluded.dps,
    power_on = excluded.power_on, mode = excluded.mode, soll = excluded.soll, ist = excluded.ist, heizt = excluded.heizt,
    dp101 = excluded.dp101, korrektur = excluded.korrektur, fuehler = excluded.fuehler, befund = excluded.befund;
  return 'ok';
end $$;

grant execute on function public.thermostat_state_upsert(uuid, jsonb) to anon, authenticated;

-- =====================================================================================
-- 3. Auswertungen für die App
-- =====================================================================================

-- Schaltpunkte je Raum: bei welcher Abweichung vom Sollwert schaltet das Thermostat ein und aus?
-- Nur Wechsel, bei denen der Sollwert seit mind. 30 min unverändert war (keine Sollwert-Sprünge).
create or replace function public.protokoll_schaltpunkte(p_tage int default 3)
returns table (room_id uuid, raum text, leistung_w numeric, einschaltungen bigint,
               ein_bei numeric, aus_bei numeric, nachlauf numeric, heiz_min numeric, zyklus_min numeric)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select room_id, timestamp as ts, temperature as t, is_heating as h,
           lag(is_heating) over w as ph,
           max(temperature) over (partition by room_id order by timestamp rows between current row and 6 following) as t_danach,
           extract(epoch from lead(timestamp) over w - timestamp) / 60 as dt_min
    from room_temperature_samples
    where timestamp > now() - make_interval(days => p_tage)
    window w as (partition by room_id order by timestamp)
  ),
  heiz as (select room_id, sum(least(dt_min, 15)) filter (where h) as heiz_min from s group by room_id),
  tw as (
    select s.*, c.value as soll, c.executed_at
    from s
    left join lateral (
      select value, executed_at from thermostat_commands c
      where c.room_id = s.room_id and c.command = 'set_temp' and c.status = 'executed' and c.executed_at <= s.ts
      order by c.executed_at desc limit 1
    ) c on true
    where s.ph is not null and s.h <> s.ph
  )
  select r.id, r.name, r.heating_power_w,
         count(*) filter (where tw.h),
         round(avg(tw.t - tw.soll) filter (where tw.h), 2),
         round(avg(tw.t - tw.soll) filter (where not tw.h), 2),
         round(avg(tw.t_danach - tw.soll) filter (where not tw.h), 2),
         round(max(heiz.heiz_min)),
         round(max(heiz.heiz_min) / nullif(count(*) filter (where tw.h), 0))
  from rooms r
  left join tw on tw.room_id = r.id and tw.executed_at < tw.ts - interval '30 minutes' and tw.soll > 6
  left join heiz on heiz.room_id = r.id
  group by r.id, r.name, r.heating_power_w, r.priority
  order by r.priority nulls last, r.name;
$$;

-- Energie je Stunde: Verbrauch gegen Summe der heizenden Räume, Quelle PV/Batterie/Netz
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
  h as (select s.hr, sum(s.anteil * coalesce(r.heating_power_w, 0)) as w from s join rooms r on r.id = s.room_id group by 1)
  select e.hr, round(e.c), round(coalesce(h.w, 0)), round(e.c - coalesce(h.w, 0)), round(e.pv), round(e.batt), round(e.netz), round(e.soc::numeric, 1)
  from e left join h using (hr) order by e.hr;
$$;

-- Energie je Raum für einen Tag, aufgeteilt auf die Stromquelle (anteilig je Stunde)
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
         round(sum(s.anteil * coalesce(r.heating_power_w, 0)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.heating_power_w, 0) * greatest(e.c - e.batt - e.netz, 0) / nullif(e.c, 0)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.heating_power_w, 0) * e.batt / nullif(e.c, 0)) / 1000, 2),
         round(sum(s.anteil * coalesce(r.heating_power_w, 0) * e.netz / nullif(e.c, 0)) / 1000, 2)
  from s join rooms r on r.id = s.room_id join e using (hr)
  where s.anteil > 0
  group by r.id, r.name
  order by 4 desc;
$$;

grant execute on function public.protokoll_schaltpunkte(int), public.protokoll_energie_stunden(date), public.protokoll_energie_raeume(date) to authenticated;

-- =====================================================================================
-- 4. Aufräumen: Protokoll 180 Tage, Datenpunkt-Log 90 Tage
-- =====================================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'protokoll-aufraeumen';
select cron.schedule('protokoll-aufraeumen', '17 3 * * *',
  $$delete from public.protokoll_events where ts < now() - interval '180 days';
    delete from public.thermostat_dp_log where ts < now() - interval '90 days';$$);

-- Startpunkt im Protokoll
select public.protokoll_add('einstellung', null, 'Protokoll-Modul eingerichtet', 'SQL 11_protokoll_modul.sql', null);

-- Kontrolle
select tgname, tgrelid::regclass from pg_trigger where tgname like 'trg_protokoll_%' order by 1;
select relname, relrowsecurity from pg_class where relname in ('protokoll_events', 'thermostat_state', 'thermostat_dp_log');
select * from public.protokoll_schaltpunkte(3);

-- Rückweg (nur falls nötig):
-- drop trigger if exists trg_protokoll_command on public.thermostat_commands;
-- drop trigger if exists trg_protokoll_heizt on public.room_heating_logs;
-- drop trigger if exists trg_protokoll_modus on public.system_settings;
-- drop trigger if exists trg_protokoll_raum on public.rooms;
-- drop trigger if exists trg_protokoll_haus on public.heating_settings;
-- drop trigger if exists trg_protokoll_anwesenheit on public.presence_periods;
-- drop trigger if exists trg_protokoll_fehler on public.api_errors;
-- select cron.unschedule('protokoll-aufraeumen');
-- drop table if exists public.protokoll_events, public.thermostat_state, public.thermostat_dp_log;
