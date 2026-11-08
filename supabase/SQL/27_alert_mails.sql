-- 27_alert_mails.sql  (08.11.2026)
-- Doku: doc/FIX-ALERT-MAILS-2026-11-08.md
--
-- Problem: Büro-Thermostat seit 07.11. offline → alle 2 h zwei Mails („Gerätefehler“ / „wieder in Ordnung“),
-- 17 Mails in 14 Stunden. Ursache: system_problems() las die Erreichbarkeit aus api_errors. Diese Einträge werden
-- von drei Stellen geschlossen, ohne dass das Gerät zurück ist:
--   - auto-resolve-api-errors Regel (c): nach 2 h
--   - pv-automation im Lokal-Modus: beim bloßen Einreihen eines Befehls (setzt auch last_thermostat_sync = jetzt)
--   - Sicherheitsnetz 24 h
-- Danach legt der Dienst einen neuen Fehler an, der erst nach 15 min zählt → Lücke → Mail-Pingpong.
--
-- Lösung hier (nur system_problems, sonst nichts):
--   1) Thermostate: Erreichbarkeit aus thermostat_state.read_at – das schreibt NUR der Thermostat-Dienst bei einer
--      echten Lesung (Dienst v1.4, RPC thermostat_state_upsert). Ein Problem je Raum, Schlüssel thermo:<room_id>.
--      Nur wenn der Thermostat-Dienst selbst läuft – sonst meldet cloud:tuya EIN Problem statt zwölf.
--   2) Übrige api_errors: je Quelle + Fehlerart ein eigener Schlüssel (err:<source>:<type>), lesbarer Text.
--      Wird ein Fehler geschlossen und gleich neu angelegt (≤ 10 min), zählt das als derselbe Fehler (keine Lücke).
--      device_offline / connection_error sind hier ausgenommen – die deckt Punkt 1 ab.
--   3) Umstellung ohne Fehl-Mail: der alte Sammel-Schlüssel cloud:api_errors wird still geschlossen.
--
-- REIHENFOLGE: erst die Edge Function system-alert (neue Fassung) deployen, dann dieses Skript.
-- Im Supabase SQL-Editor ausführen (wiederholbar).

create or replace function public.system_problems()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  res jsonb := '[]'::jsonb;
  r record;
  v_last timestamptz;
  v_n int;
  v_codes text;
  v_tuya_ok boolean;
begin
  -- PCs, die sich nicht mehr melden (> 10 min)
  for r in select host, label, last_seen from system_hosts
            where host <> 'cloud' and (last_seen is null or last_seen < now() - interval '10 minutes') loop
    res := res || jsonb_build_object('key', 'host:' || r.host, 'area', r.label,
      'text', r.label || ' meldet sich nicht' ||
        coalesce(' seit ' || to_char(r.last_seen at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ''));
  end loop;

  -- Dienste, die nicht laufen (> 3 min), nur auf PCs, die sich melden; per App gestoppte zählen nicht
  for r in select s.*, h.label as host_label from system_services s join system_hosts h using (host)
            where s.status <> 'running' and not s.intended_stop
              and s.status_since < now() - interval '3 minutes'
              and (s.host = 'cloud' or h.last_seen > now() - interval '10 minutes') loop
    res := res || jsonb_build_object('key', 'svc:' || r.host || ':' || r.name, 'area', r.host_label,
      'text', r.label || case
                when r.kind = 'web' then ' ist nicht erreichbar'
                when r.status = 'stopped' then ' läuft nicht'
                else ': Zustand unbekannt' end
              || ' (seit ' || to_char(r.status_since at time zone 'Europe/Vienna', 'DD.MM. HH24:MI') || ')');
  end loop;

  -- Fronius-Daten (> 15 min keine Messung)
  select max(timestamp) into v_last from energy_readings where timestamp > now() - interval '7 days';
  if v_last is null or v_last < now() - interval '15 minutes' then
    res := res || jsonb_build_object('key', 'cloud:fronius', 'area', 'Cloud',
      'text', 'Keine Fronius-Daten' || coalesce(' seit ' || to_char(v_last at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ' (7 Tage)'));
  end if;

  -- Thermostat-Dienst (Herzschlag > 10 min alt)
  select last_sync into v_last from service_health where service_name = 'tuya-thermostat';
  v_tuya_ok := v_last is not null and v_last >= now() - interval '10 minutes';
  if not v_tuya_ok then
    res := res || jsonb_build_object('key', 'cloud:tuya', 'area', 'Cloud',
      'text', 'Thermostat-Dienst meldet sich nicht' || coalesce(' seit ' || to_char(v_last at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ''));
  end if;

  -- NEU 08.11.2026: Thermostate einzeln, aus der letzten ECHTEN Lesung (thermostat_state.read_at).
  -- Nicht aus api_errors / rooms.last_thermostat_sync – die setzt pv-automation im Lokal-Modus auch ohne Antwort.
  if v_tuya_ok then
    for r in select rm.id, rm.name, ts.read_at
               from rooms rm left join thermostat_state ts on ts.room_id = rm.id
              where rm.tuya_device_id is not null
                and (ts.read_at is null or ts.read_at < now() - interval '15 minutes')
              order by rm.priority loop
      res := res || jsonb_build_object('key', 'thermo:' || r.id, 'area', 'Thermostate',
        'text', 'Thermostat ' || r.name || ' nicht erreichbar' ||
          coalesce(' seit ' || to_char(r.read_at at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ' (noch nie gelesen)'));
    end loop;
  end if;

  -- Übrige Fehler aus api_errors, je Quelle + Fehlerart (Geräte-Erreichbarkeit siehe oben).
  -- Zählt ab 15 min – oder sofort, wenn ein gleicher Fehler (selbst ≥ 15 min alt) kurz davor geschlossen wurde
  -- (≤ 10 min Lücke): sonst entsteht durch Schließen + Neuanlegen eine Lücke und damit eine Fehl-Mail.
  for r in select e.source, e.error_type, min(e.created_at) as first_at,
                  (array_agg(e.error_message order by e.created_at desc))[1] as msg
             from api_errors e
            where e.resolved_at is null and e.error_type not in ('device_offline', 'connection_error')
            group by e.source, e.error_type loop
    if r.first_at < now() - interval '15 minutes'
       or exists (select 1 from api_errors p
                   where p.source = r.source and p.error_type = r.error_type
                     and p.resolved_at between r.first_at - interval '10 minutes' and r.first_at + interval '1 minute'
                     and p.resolved_at - p.created_at >= interval '15 minutes') then
      res := res || jsonb_build_object('key', 'err:' || r.source || ':' || r.error_type, 'area', 'Cloud',
        'text', case r.error_type
                  when 'no_control_channel'    then 'Thermostat-Befehle werden nicht abgeholt (lokaler Dienst antwortet nicht)'
                  when 'local_service_offline' then 'Thermostat-Befehle werden nicht abgeholt (lokaler Dienst antwortet nicht)'
                  when 'night_frost_failed'    then 'Nacht-Befehl an die Thermostate konnte nicht gesendet werden'
                  when 'tuya_api'              then 'Fehler der Tuya-Cloud'
                  else coalesce(left(r.msg, 80), r.error_type) end
          || ' (' || r.source || ', seit ' || to_char(r.first_at at time zone 'Europe/Vienna', 'DD.MM. HH24:MI') || ')');
    end if;
  end loop;

  -- Zeitgesteuerte Aufgaben (pg_cron) mit Fehlschlag in den letzten 24 h
  for r in select j.jobname, count(*) as n, max(d.start_time) as last_fail
             from cron.job_run_details d join cron.job j using (jobid)
            where d.start_time > now() - interval '24 hours' and d.status = 'failed'
            group by j.jobname loop
    res := res || jsonb_build_object('key', 'cron:' || r.jobname, 'area', 'Cloud',
      'text', 'Aufgabe ' || r.jobname || ': ' || r.n || '× fehlgeschlagen (zuletzt ' ||
        to_char(r.last_fail at time zone 'Europe/Vienna', 'DD.MM. HH24:MI') || ')');
  end loop;

  -- Function-Aufrufe der Cron-Jobs mit HTTP-Fehler in den letzten 2 h
  select count(*), string_agg(distinct status_code::text, ', ')
    into v_n, v_codes
    from net._http_response where created > now() - interval '2 hours' and status_code >= 400;
  if v_n > 0 then
    res := res || jsonb_build_object('key', 'cloud:net', 'area', 'Cloud',
      'text', v_n || case when v_n = 1 then ' Function-Aufruf' else ' Function-Aufrufe' end
        || ' mit Fehler in 2 h (HTTP ' || v_codes || ')');
  end if;

  -- Heizung München (SQL 23)
  if to_regclass('public.muc_collector_status') is not null then
    for r in select last_seen, fenecon_ok, loxone_ok, last_error from muc_collector_status where id = 1 loop
      if r.last_seen is null or r.last_seen < now() - interval '10 minutes' then
        res := res || jsonb_build_object('key', 'muc:collector', 'area', 'Heizung München',
          'text', 'Collector meldet sich nicht' || coalesce(' seit ' || to_char(r.last_seen at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ''));
      else
        if r.fenecon_ok is false then
          res := res || jsonb_build_object('key', 'muc:fenecon', 'area', 'Heizung München', 'text', 'FENECON nicht erreichbar');
        end if;
        if r.loxone_ok is false then
          res := res || jsonb_build_object('key', 'muc:loxone', 'area', 'Heizung München', 'text', 'Loxone nicht erreichbar');
        end if;
      end if;
    end loop;
  end if;

  return res;
end;
$$;

revoke all on function public.system_problems() from public, anon;
grant execute on function public.system_problems() to authenticated, service_role;

-- Umstellung: alten Sammel-Schlüssel still schließen (sonst käme in 15 min eine falsche „gelöst“-Mail).
-- Das Büro meldet die neue Fassung dann einmal als thermo:<Raum> – mit Lösungsansatz.
update public.system_alert_state
   set resolved_at = now(), resolved_notified_at = now()
 where key = 'cloud:api_errors' and resolved_at is null;

-- Prüfen (erwartet heute: ein Eintrag „Thermostat Büro nicht erreichbar seit 07.11. 16:48“):
--   select * from jsonb_array_elements(public.system_problems());
-- Rückweg: Funktion aus 22_systemstatus.sql + 23_systemstatus_muenchen.sql erneut ausführen.
