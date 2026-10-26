-- ============================================================
-- 04_heizzyklen_trigger.sql  (Stand 26.10.2026)
-- ============================================================
-- Problem: room_heating_logs enthaelt seit Wochen KEINE heating_start/heating_stop.
--   1. Bis v1.3 (24.10.2026) las der lokale Treiber das falsche DP -> is_heating war
--      immer false, es gab keinen Wechsel.
--   2. Seit v1.3 stimmt is_heating, aber der Insert des Dienstes (anon-Schluessel)
--      scheitert an RLS: room_heating_logs hat nur eine Policy fuer authenticated.
--   Folge: Heizzyklen fehlen Lernsystem (ml-feature-extraction, calculate-heating-power,
--   evaluate-decision, compute-daily-score), Verbrauchsanzeige und Raum-Statistik.
--
-- Loesung: Datenbank-Trigger auf rooms.is_heating (wie trg_capture_room_temperature_sample).
--   - SECURITY DEFINER -> unabhaengig von RLS, KEINE neue anon-Berechtigung noetig
--     (der anon-Schluessel steckt oeffentlich im Frontend).
--   - Wirkt fuer jeden Schreiber: lokaler Dienst, tuya-control sync-all (Cloud),
--     pv-automation.
--   - Doppelschutz: Ein Start wird nur geschrieben, wenn kein offener Start existiert;
--     ein Stop nur, wenn ein offener Start existiert. tuya-control (Cloud) schreibt
--     seine Eintraege VOR dem rooms-Update -> der Trigger sieht sie und schreibt nichts.
--   - Stop bekommt duration_minutes + energy_estimate_wh (Raumleistung x Dauer), wie
--     es alle Auswerter erwarten. Ohne offenen Start (< 12 h) wird kein Stop geschrieben
--     (keine erfundene Dauer).
--   - Fehler im Trigger brechen das rooms-Update NIE ab (EXCEPTION -> WARNING).
--
-- Wiederholbar (create or replace / drop if exists).
-- Rueckweg:  drop trigger if exists trg_log_room_heating_transition on public.rooms;
-- ============================================================

create or replace function public.log_room_heating_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_last_type   text;
  v_last_ts     timestamptz;
  v_open_start  boolean;
  v_now         timestamptz := coalesce(new.last_thermostat_sync, now());
  v_duration    integer;
  v_power_w     numeric;
  v_consumption integer;
  v_surplus     integer;
  v_start_cons  integer;
begin
  -- Nur echte Zustandswechsel
  if new.is_heating is null or old.is_heating is not distinct from new.is_heating then
    return new;
  end if;

  -- Letztes Heiz-Ereignis dieses Raums
  select event_type, "timestamp", consumption_at_start_w
    into v_last_type, v_last_ts, v_start_cons
  from public.room_heating_logs
  where room_id = new.id
    and event_type in ('heating_start', 'heating_stop')
  order by "timestamp" desc
  limit 1;

  -- Offener Start = letztes Ereignis ist ein Start und juenger als 12 h
  v_open_start := v_last_type = 'heating_start' and v_last_ts > v_now - interval '12 hours';

  -- Aktuelle Energiedaten (letzte 10 Minuten)
  select round(consumption)::int, greatest(0, round(-power_io))::int
    into v_consumption, v_surplus
  from public.energy_readings
  where "timestamp" > now() - interval '10 minutes'
  order by "timestamp" desc
  limit 1;

  if new.is_heating then
    if v_open_start then
      return new;                       -- schon offen (z. B. Cloud-Sync hat geschrieben)
    end if;
    insert into public.room_heating_logs
      (room_id, event_type, current_temp, target_temp, pv_surplus_w, consumption_at_start_w, "timestamp")
    values
      (new.id, 'heating_start', new.current_temp, new.target_temp, v_surplus, v_consumption, v_now);
  else
    if not v_open_start then
      return new;                       -- kein offener Start -> keine erfundene Dauer
    end if;
    v_duration := greatest(1, round(extract(epoch from (v_now - v_last_ts)) / 60))::int;
    v_power_w  := coalesce(new.calculated_power_w, new.heating_power_w,
                           case when new.floor_area_m2 is not null then new.floor_area_m2 * 60 end,
                           800);
    insert into public.room_heating_logs
      (room_id, event_type, current_temp, target_temp, duration_minutes, energy_estimate_wh,
       pv_surplus_w, consumption_at_start_w, consumption_during_avg_w, "timestamp")
    values
      (new.id, 'heating_stop', new.current_temp, new.target_temp, v_duration,
       round(v_power_w * v_duration / 60.0)::int,
       v_surplus, v_start_cons, v_consumption, v_now);
  end if;

  return new;
exception when others then
  raise warning 'log_room_heating_transition (%): %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_log_room_heating_transition on public.rooms;
create trigger trg_log_room_heating_transition
  after update of is_heating on public.rooms
  for each row execute function public.log_room_heating_transition();

-- ------------------------------------------------------------
-- Kontrolle 1: Trigger angelegt?
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.rooms'::regclass and not tgisinternal
order by tgname;

-- Kontrolle 2 (nach 1-2 Stunden Heizbetrieb): kommen Zyklen an?
-- select r.name, l.event_type, l."timestamp" at time zone 'Europe/Vienna' as wien,
--        l.duration_minutes, l.energy_estimate_wh
-- from room_heating_logs l join rooms r on r.id = l.room_id
-- where l.event_type in ('heating_start','heating_stop')
--   and l."timestamp" > now() - interval '3 hours'
-- order by l."timestamp" desc;
