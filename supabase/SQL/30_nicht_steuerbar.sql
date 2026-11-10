-- SQL 30 – Wirkungsprüfung „nicht steuerbar“ (10.11.2026, doc/FIX-REGELN-A-B-C-2026-11-10.md, Vorschlag C)
--
-- Anlass: Kinder Bad nahm seit mindestens 01.11. keinen Befehl an (Test 10.11.: Lesen ok, Schreiben „Timeout set“).
-- Der Thermostat-Dienst meldete trotzdem jeden Befehl als „executed“ (1727 Befehle seit 01.11., keiner wirkte).
--
-- Neu: Bei jeder Lesung (thermostat_state_upsert) wird gezählt, wie viele ausgeführte set_temp-Befehle seit der
-- letzten Sollwert-Änderung am Gerät (DP 2) einen anderen Wert hatten als den, den das Gerät jetzt meldet.
--   ≥ 4  → rooms.nicht_steuerbar_seit setzen (Nachrechnung 3 Tage: funktionierende Geräte max. 2, Kinder Bad bis 278), Fehler „not_controllable“ (Banner), Befund im Protokoll
--   0    → Markierung löschen, Fehler schließen (z. B. nach Reparatur: der stündliche Prüfbefehl wirkt)
-- pv-automation schickt markierten Räumen keine Befehle mehr, nur einen Prüfbefehl pro Stunde.
-- Kann gefahrlos mehrfach ausgeführt werden.

alter table public.rooms add column if not exists nicht_steuerbar_seit timestamptz;
alter table public.rooms add column if not exists nicht_steuerbar_grund text;

CREATE OR REPLACE FUNCTION public.thermostat_state_upsert(p_room_id uuid, p_dps jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Wirkungsprüfung (SQL 30)
  v_last_dp2 timestamptz;
  v_ohne int;
  v_flag timestamptz;
  v_dev text;
  v_name text;
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

  -- Wirkungsprüfung (SQL 30): ausgeführte Befehle seit der letzten Sollwert-Änderung am Gerät, die nicht angekommen sind
  if v_soll is not null then
    select max(ts) into v_last_dp2 from thermostat_dp_log where room_id = p_room_id and dp = '2';
    select count(*) into v_ohne from thermostat_commands
     where room_id = p_room_id and command = 'set_temp' and status = 'executed'
       and executed_at > greatest(coalesce(v_last_dp2, '-infinity'::timestamptz), now() - interval '24 hours')
       and executed_at < now() - interval '1 minute'
       and abs(value - v_soll) >= 0.05;
    select nicht_steuerbar_seit, tuya_device_id, name into v_flag, v_dev, v_name from rooms where id = p_room_id;
    if v_ohne >= 4 then
      v_befund := v_befund || 'nimmt keine Befehle an'::text;  -- ohne Zahl, sonst neuer Protokolleintrag bei jeder Lesung
      if v_flag is null then
        update rooms set nicht_steuerbar_seit = now(),
          nicht_steuerbar_grund = v_ohne || ' ausgeführte Befehle ohne Wirkung, Gerät meldet weiter Soll ' || fmt_t(v_soll)
         where id = p_room_id;
        insert into api_errors (source, room_id, room_name, device_id, error_type, error_message, error_code)
        values ('thermostat_state_upsert', p_room_id, v_name, v_dev, 'not_controllable',
          v_name || ': Thermostat nimmt keine Befehle an – ' || v_ohne || ' Befehle ohne Wirkung, Soll bleibt ' || fmt_t(v_soll)
          || '. Steuerung schickt nur noch einen Prüfbefehl pro Stunde.', 'NOT_CONTROLLABLE');
      end if;
    elsif v_ohne = 0 and v_flag is not null then
      update rooms set nicht_steuerbar_seit = null, nicht_steuerbar_grund = null where id = p_room_id;
      update api_errors set resolved_at = now()
       where room_id = p_room_id and error_type = 'not_controllable' and resolved_at is null;
      perform protokoll_add('thermostat', p_room_id, 'nimmt wieder Befehle an', 'Wirkungsprüfung: Sollwert am Gerät folgt dem Befehl',
        jsonb_build_object('soll', v_soll));
    end if;
  end if;

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
end $function$;
