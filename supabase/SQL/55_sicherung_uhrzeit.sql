-- 55_sicherung_uhrzeit.sql  (24.11.2026)
-- Uhrzeit der nächtlichen Sicherung aus der App ändern (Einstellungen › Datensicherung, Karte je PC) –
-- in Heizung Venediger und Heizung München. Doku: doc/DATENSICHERUNG.md (Abschnitt „Uhrzeit ändern“).
--
-- Uli, 24.11.2026: „Ich will eine Einstellung in den Karten, um die Zeiten zu ändern. Ich ändere die Zeit und drücke
-- einen Button, der die Änderung ausführt.“
--
-- Weg: Die App legt einen Befehl in service_commands an (action = 'backup_time', param = 'HH:MM').
-- Der Dienste-Wächter des PCs (ab v1.1) holt ihn wie Start/Stop ab, stellt die geplante Aufgabe
-- „Supabase-Sicherung Heizung“ auf täglich HH:MM (Ortszeit) und meldet den nächsten Lauf zurück.
-- Gleiche Regeln wie für Dienste: nur Admins, PC muss sich melden, kein zweiter Befehl offen.
-- Im Supabase SQL-Editor ausführen (wiederholbar).

alter table public.service_commands add column if not exists param text;
alter table public.service_commands drop constraint if exists service_commands_action_check;
alter table public.service_commands add constraint service_commands_action_check
  check (action in ('start', 'stop', 'restart', 'backup_time'));
alter table public.service_commands drop constraint if exists service_commands_param_check;
alter table public.service_commands add constraint service_commands_param_check
  check ((action = 'backup_time' and param ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or (action <> 'backup_time' and param is null));

-- Darf dieser Befehl abgesetzt werden? backup_time: PC bekannt (nicht die Cloud), Name „backup“
create or replace function public.service_command_allowed(p_host text, p_name text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    case when p_action = 'backup_time' then
      p_name = 'backup' and exists (select 1 from public.system_hosts h where h.host = p_host and h.host <> 'cloud')
    else exists (
      select 1 from public.system_services s
       where s.host = p_host and s.name = p_name and s.kind in ('nssm','extra')
         and (s.control = 'full' or (s.control = 'start_only' and p_action = 'start')))
    end)
  and not exists (
    select 1 from public.service_commands c
     where c.host = p_host and c.service_name = p_name and c.status in ('pending','running')
  );
$$;

-- Befehle mit Parameter an den Wächter geben (sonst wie SQL 22)
create or replace function public.system_agent_report(p_host text, p_label text, p_version text, p_info jsonb, p_services jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

  delete from system_services
   where host = p_host
     and name not in (select e->>'name' from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) e);

  update service_commands set status = 'expired', executed_at = now(),
         result = case when status = 'pending' then 'nicht abgeholt' else 'keine Rückmeldung' end
   where status in ('pending', 'running') and created_at < now() - interval '15 minutes';

  with c as (
    update service_commands set status = 'running'
     where host = p_host and status = 'pending'
    returning id, service_name, action, param
  )
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cmds from c;
  return v_cmds;
end;
$function$;

select 'SQL 55 ausgeführt' as ergebnis;
