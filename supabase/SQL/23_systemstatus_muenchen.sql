-- 23_systemstatus_muenchen.sql  (05.11.2026)
-- Systemstatus auch in der App Heizung München (Uli: „ich wollte es in beiden“):
--  1) Anmeldung München (uli.berresheim+muc@hotmail.de) darf ebenfalls steuern
--  2) system_problems(): Collector Heizung München (muc_collector_status) – meldet sich nicht > 10 min,
--     FENECON oder Loxone nicht erreichbar
--  3) system_cloud_status(): Feld 'muc' für die Zeile „Heizung München (Collector)“ in beiden Apps
-- Im Supabase SQL-Editor ausführen (wiederholbar). Doku: doc/SYSTEMSTATUS-2026-11-05.md

-- 1) zweites Konto als Admin
insert into public.system_status_admins (user_id, note)
  select id, 'Uli (Anmeldung München)' from auth.users where email = 'uli.berresheim+muc@hotmail.de'
  on conflict (user_id) do nothing;

-- 2) Probleme
create or replace function public.system_problems()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  res jsonb := '[]'::jsonb;
  r record;
  v_last timestamptz;
  v_n int;
  v_codes text;
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
  if v_last is null or v_last < now() - interval '10 minutes' then
    res := res || jsonb_build_object('key', 'cloud:tuya', 'area', 'Cloud',
      'text', 'Thermostat-Dienst meldet sich nicht' || coalesce(' seit ' || to_char(v_last at time zone 'Europe/Vienna', 'DD.MM. HH24:MI'), ''));
  end if;

  -- Thermostat-Fehler, die länger als 15 min offen sind (kurze Aussetzer zählen nicht)
  select count(*) into v_n from api_errors where resolved_at is null and created_at < now() - interval '15 minutes';
  if v_n > 0 then
    res := res || jsonb_build_object('key', 'cloud:api_errors', 'area', 'Cloud',
      'text', v_n || case when v_n = 1 then ' offener Gerätefehler' else ' offene Gerätefehler' end
        || ' seit über 15 min (Übersicht › Fehler)');
  end if;

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
  -- („succeeded“ im Cron heißt nur: SQL lief – ein 401 der Function steht nur hier, siehe learnings)
  select count(*), string_agg(distinct status_code::text, ', ')
    into v_n, v_codes
    from net._http_response where created > now() - interval '2 hours' and status_code >= 400;
  if v_n > 0 then
    res := res || jsonb_build_object('key', 'cloud:net', 'area', 'Cloud',
      'text', v_n || case when v_n = 1 then ' Function-Aufruf' else ' Function-Aufrufe' end
        || ' mit Fehler in 2 h (HTTP ' || v_codes || ')');
  end if;

  -- Heizung München: Collector (FENECON + Loxone) meldet sich nicht (> 10 min) oder meldet einen Fehler
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

-- 3) Cloud-Zustand
-- muc_collector_status kommt aus heizung-muenchen/supabase/schema.sql (gleiches Supabase-Projekt)
create or replace function public.system_cloud_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'last_energy', (select max(timestamp) from energy_readings where timestamp > now() - interval '7 days'),
    'tuya', (select jsonb_build_object('last_sync', last_sync, 'devices_ok', devices_ok,
                                       'devices_configured', devices_configured)
               from service_health where service_name = 'tuya-thermostat'),
    'open_api_errors', (select count(*) from api_errors where resolved_at is null),
    'cron', (select jsonb_build_object(
               'jobs', (select count(*) from cron.job where active),
               'runs_24h', (select count(*) from cron.job_run_details where start_time > now() - interval '24 hours'),
               'failed_24h', (select count(*) from cron.job_run_details where start_time > now() - interval '24 hours' and status = 'failed'),
               'last_run', (select max(start_time) from cron.job_run_details))),
    'pv_automation_last', (select max(d.start_time) from cron.job_run_details d join cron.job j using (jobid)
                            where j.jobname = 'pv-automation-check' and d.status = 'succeeded'),
    'muc', (select jsonb_build_object('last_seen', last_seen, 'fenecon_ok', fenecon_ok, 'loxone_ok', loxone_ok,
                                      'house_mode', house_mode, 'version', version, 'last_error', last_error)
              from muc_collector_status where id = 1),
    'net_2h', (select jsonb_build_object(
                 'ok', count(*) filter (where status_code between 200 and 399),
                 'errors', count(*) filter (where status_code >= 400),
                 'timeouts', count(*) filter (where status_code is null))
               from net._http_response where created > now() - interval '2 hours')
  );
$$;
