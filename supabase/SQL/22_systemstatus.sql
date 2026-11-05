-- 22_systemstatus.sql  (05.11.2026)
-- Systemstatus in der Kopfleiste (Mockup von Uli freigegeben 05.11.2026, Doku doc/SYSTEMSTATUS-2026-11-05.md):
-- Laufen alle Prozesse – auf dem Österreich-PC, dem München-PC und in der Cloud – und kann ich sie steuern?
--
--  1) system_hosts         – je PC eine Zeile; der Dienste-Wächter meldet sich alle 30 s (last_seen)
--  2) system_services      – je PC und Dienst der Zustand (läuft / gestoppt / unbekannt) + was erlaubt ist
--                            host 'cloud' = Webseiten, die die Function system-alert alle 5 min aufruft
--  3) service_commands     – Start/Stop/Neustart aus der App; der Wächter holt sie ab (wie thermostat_commands)
--  4) system_status_admins – wer steuern darf (nur Uli); ansehen dürfen alle Angemeldeten
--  5) system_alert_state   – welche Probleme schon per Mail gemeldet wurden (keine Mail-Flut)
--  6) system_problems()    – EINE Liste der Probleme, für die App UND für die Mail
--  7) system_cloud_status()– Zustand der Cloud für das Fenster (Fronius-Daten, Thermostat-Dienst, Cron, Function-Aufrufe)
--  8) Cron system-alert-5min
--
-- Sicherheit: Der Wächter schreibt NICHT mit dem öffentlichen anon-Schlüssel, sondern über die Edge Function
-- system-agent mit eigenem Token (Secret SYSTEM_AGENT_TOKEN). Für anon gibt es auf diesen Tabellen keine Rechte.
-- Befehle prüft die Datenbank selbst: nur Admins, nur bekannte Dienste, Fernzugriff nur „Start“.
--
-- Im Supabase SQL-Editor ausführen (wiederholbar).

-- 1) PCs -------------------------------------------------------------------------------------------------
create table if not exists public.system_hosts (
  host          text primary key check (host ~ '^[a-z0-9-]{1,40}$'),
  label         text not null,
  last_seen     timestamptz,
  agent_version text,
  info          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
insert into public.system_hosts (host, label, last_seen) values ('cloud', 'Cloud', now())
  on conflict (host) do nothing;

-- 2) Dienste ---------------------------------------------------------------------------------------------
--   kind:    nssm  = NSSM-Dienst (automatisch gefunden)
--            extra = anderer Windows-Dienst aus der Wächter-Konfiguration (z. B. Tailscale)
--            web   = Webseite (Erreichbarkeit)
--   control: full       = Start, Stop, Neustart
--            start_only = nur Start (Fernzugriff: Tailscale, Cloudflare – nie aus der Ferne abschalten)
--            none       = nur ansehen (der Wächter selbst, Webseiten)
create table if not exists public.system_services (
  host          text not null references public.system_hosts(host) on delete cascade,
  name          text not null check (name ~ '^[A-Za-z0-9_.-]{1,80}$'),
  label         text not null,
  url           text,
  kind          text not null check (kind in ('nssm','extra','web')),
  control       text not null default 'none' check (control in ('full','start_only','none')),
  status        text not null default 'unknown' check (status in ('running','stopped','unknown')),
  status_since  timestamptz not null default now(),
  detail        text,
  intended_stop boolean not null default false,   -- per App gestoppt → kein Problem, keine Mail
  updated_at    timestamptz not null default now(),
  primary key (host, name)
);

-- 3) Befehle ---------------------------------------------------------------------------------------------
create table if not exists public.service_commands (
  id            uuid primary key default gen_random_uuid(),
  host          text not null,
  service_name  text not null,
  action        text not null check (action in ('start','stop','restart')),
  status        text not null default 'pending' check (status in ('pending','running','done','failed','expired')),
  result        text,
  requested_by  uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  executed_at   timestamptz
);
create index if not exists service_commands_pending_idx on public.service_commands (host, status) where status = 'pending';

-- 4) Wer steuern darf ------------------------------------------------------------------------------------
create table if not exists public.system_status_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
insert into public.system_status_admins (user_id, note)
  select id, 'Uli' from auth.users where email = 'uli.berresheim@hotmail.de'
  on conflict (user_id) do nothing;

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.system_status_admins where user_id = auth.uid());
$$;

-- Darf dieser Befehl abgesetzt werden? (Dienst bekannt, Aktion zur Freigabe passend, kein gleicher Befehl offen)
create or replace function public.service_command_allowed(p_host text, p_name text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.system_services s
     where s.host = p_host and s.name = p_name and s.kind in ('nssm','extra')
       and (s.control = 'full' or (s.control = 'start_only' and p_action = 'start'))
  )
  and not exists (
    select 1 from public.service_commands c
     where c.host = p_host and c.service_name = p_name and c.status in ('pending','running')
  );
$$;

-- 5) Mail-Zustand ----------------------------------------------------------------------------------------
create table if not exists public.system_alert_state (
  key                  text primary key,
  area                 text,
  text                 text,
  first_seen           timestamptz not null default now(),
  last_seen            timestamptz not null default now(),
  notified_at          timestamptz,
  resolved_at          timestamptz,
  resolved_notified_at timestamptz
);

-- RLS ----------------------------------------------------------------------------------------------------
alter table public.system_hosts         enable row level security;
alter table public.system_services      enable row level security;
alter table public.service_commands     enable row level security;
alter table public.system_status_admins enable row level security;
alter table public.system_alert_state   enable row level security;

drop policy if exists "angemeldet lesen" on public.system_hosts;
create policy "angemeldet lesen" on public.system_hosts for select to authenticated using (true);
drop policy if exists "angemeldet lesen" on public.system_services;
create policy "angemeldet lesen" on public.system_services for select to authenticated using (true);
drop policy if exists "angemeldet lesen" on public.service_commands;
create policy "angemeldet lesen" on public.service_commands for select to authenticated using (true);
drop policy if exists "admin befehl anlegen" on public.service_commands;
create policy "admin befehl anlegen" on public.service_commands for insert to authenticated
  with check (public.is_system_admin()
              and status = 'pending'
              and requested_by = auth.uid()
              and public.service_command_allowed(host, service_name, action));
drop policy if exists "eigene zeile lesen" on public.system_status_admins;
create policy "eigene zeile lesen" on public.system_status_admins for select to authenticated using (user_id = auth.uid());
drop policy if exists "angemeldet lesen" on public.system_alert_state;
create policy "angemeldet lesen" on public.system_alert_state for select to authenticated using (true);

revoke all on public.system_hosts, public.system_services, public.service_commands,
              public.system_status_admins, public.system_alert_state from anon;
grant select on public.system_hosts, public.system_services, public.service_commands,
               public.system_status_admins, public.system_alert_state to authenticated;
grant insert on public.service_commands to authenticated;
grant all on public.system_hosts, public.system_services, public.service_commands,
              public.system_status_admins, public.system_alert_state to service_role;

-- Webseiten, die die Cloud prüft (in den Einstellungen änderbar: system_settings.system_status_websites)
insert into public.system_settings (key, value)
values ('system_status_websites', '[
  {"name":"heizung-app","label":"Heizung Venediger (App)","url":"https://heizung.steinbockchalets-charge.com"},
  {"name":"wallbox-gaeste","label":"Wallbox (Gäste)","url":"https://wallbox.steinbockchalets-charge.com"}
]'::jsonb)
on conflict (key) do nothing;

-- 6) Probleme: eine Liste für App und Mail -----------------------------------------------------------------
-- Schwellen bewusst großzügig, damit ein kurzer Aussetzer keinen Alarm auslöst.
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

  return res;
end;
$$;

-- 7) Cloud-Zustand für das Fenster -------------------------------------------------------------------------
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
    'net_2h', (select jsonb_build_object(
                 'ok', count(*) filter (where status_code between 200 and 399),
                 'errors', count(*) filter (where status_code >= 400),
                 'timeouts', count(*) filter (where status_code is null))
               from net._http_response where created > now() - interval '2 hours')
  );
$$;

revoke all on function public.system_problems(), public.system_cloud_status(),
                       public.is_system_admin(), public.service_command_allowed(text, text, text) from public, anon;
grant execute on function public.system_problems(), public.system_cloud_status(),
                          public.is_system_admin(), public.service_command_allowed(text, text, text) to authenticated, service_role;

-- 7b) Meldungen schreiben (nur service_role, aufgerufen von den Edge Functions) ----------------------------
-- Wächter meldet sich: PC + Dienste aktualisieren, offene Befehle für diesen PC ausgeben (Status → running).
create or replace function public.system_agent_report(p_host text, p_label text, p_version text,
                                                      p_info jsonb, p_services jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cmds jsonb;
begin
  if p_host = 'cloud' then raise exception 'host cloud ist reserviert'; end if;

  insert into system_hosts (host, label, last_seen, agent_version, info)
  values (p_host, coalesce(p_label, p_host), now(), p_version, coalesce(p_info, '{}'::jsonb))
  on conflict (host) do update
     set label = excluded.label, last_seen = now(), agent_version = excluded.agent_version, info = excluded.info;

  insert into system_services as s (host, name, label, url, kind, control, status, status_since, detail, updated_at)
  select p_host, e->>'name', coalesce(e->>'label', e->>'name'), e->>'url', e->>'kind',
         coalesce(e->>'control', 'none'), coalesce(e->>'status', 'unknown'), now(), e->>'detail', now()
    from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e
   where e->>'kind' in ('nssm', 'extra')
  on conflict (host, name) do update
     set label = excluded.label, url = excluded.url, kind = excluded.kind, control = excluded.control,
         status_since = case when s.status <> excluded.status then now() else s.status_since end,
         status = excluded.status, detail = excluded.detail, updated_at = now(),
         intended_stop = case when excluded.status = 'running' then false else s.intended_stop end;

  -- Dienste, die der Wächter nicht mehr meldet (deinstalliert), entfernen
  delete from system_services
   where host = p_host
     and name not in (select e->>'name' from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e);

  -- Befehle, die niemand abgeholt oder fertig gemeldet hat, verfallen lassen
  update service_commands set status = 'expired', executed_at = now(),
         result = case when status = 'pending' then 'nicht abgeholt' else 'keine Rückmeldung' end
   where status in ('pending', 'running') and created_at < now() - interval '15 minutes';

  with c as (
    update service_commands set status = 'running'
     where host = p_host and status = 'pending'
    returning id, service_name, action
  )
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cmds from c;
  return v_cmds;
end;
$$;

-- Wächter meldet das Ergebnis eines Befehls
create or replace function public.system_agent_result(p_host text, p_id uuid, p_ok boolean,
                                                      p_message text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cmd service_commands;
begin
  update service_commands
     set status = case when p_ok then 'done' else 'failed' end,
         result = left(p_message, 500), executed_at = now()
   where id = p_id and host = p_host and status = 'running'
  returning * into v_cmd;
  if v_cmd.id is null then return; end if;

  update system_services s
     set intended_stop = (p_ok and v_cmd.action = 'stop'),
         status_since = case when p_status is not null and s.status <> p_status then now() else s.status_since end,
         status = coalesce(p_status, s.status),
         updated_at = now()
   where s.host = p_host and s.name = v_cmd.service_name
     and (p_status is null or p_status in ('running', 'stopped', 'unknown'));
end;
$$;

-- Cloud prüft die Webseiten (system-alert)
create or replace function public.system_web_report(p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update system_hosts set last_seen = now() where host = 'cloud';

  insert into system_services as s (host, name, label, url, kind, control, status, status_since, detail, updated_at)
  select 'cloud', e->>'name', coalesce(e->>'label', e->>'name'), e->>'url', 'web', 'none',
         case when (e->>'ok')::boolean then 'running' else 'stopped' end, now(), e->>'detail', now()
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
  on conflict (host, name) do update
     set label = excluded.label, url = excluded.url, detail = excluded.detail, updated_at = now(),
         status_since = case when s.status <> excluded.status then now() else s.status_since end,
         status = excluded.status;

  delete from system_services
   where host = 'cloud'
     and name not in (select e->>'name' from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e);
end;
$$;

revoke all on function public.system_agent_report(text, text, text, jsonb, jsonb),
                       public.system_agent_result(text, uuid, boolean, text, text),
                       public.system_web_report(jsonb) from public, anon, authenticated;
grant execute on function public.system_agent_report(text, text, text, jsonb, jsonb),
                          public.system_agent_result(text, uuid, boolean, text, text),
                          public.system_web_report(jsonb) to service_role;

-- 8) Cron: Probleme prüfen, Webseiten aufrufen, bei Bedarf Mail (alle 5 min) --------------------------------
-- Übernimmt Kopfzeilen (anon-JWT) vom bestehenden Job auto-resolve-api-errors-5min (Muster aus learnings:
-- keine current_setting('app.anon_key')).
do $$
declare v_cmd text;
begin
  select replace(replace(command, 'auto-resolve-api-errors', 'system-alert'), '"pg_cron"', '"pg_cron_system"')
    into v_cmd from cron.job where jobname = 'auto-resolve-api-errors-5min';
  if v_cmd is null then
    raise exception 'Vorlage auto-resolve-api-errors-5min nicht gefunden';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'system-alert-5min';
  perform cron.schedule('system-alert-5min', '*/5 * * * *', v_cmd);
end $$;

-- Prüfen (Ergebnis muss .../functions/v1/system-alert enthalten):
--   select left(command, 120) from cron.job where jobname = 'system-alert-5min';
