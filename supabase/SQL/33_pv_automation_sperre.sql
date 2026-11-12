-- SQL 33 – pv-automation: höchstens ein Lauf pro 60 s (10.11.2026, doc/FIX-PRUEFUNG-REST-2026-11-10.md, K7)
-- Drei Aufrufer: Cron alle 5 min (:00), Fronius-Collector (~:00:45, also 43 s danach) und Thermostat-Dienst nach jeder
-- Abfrage (~:03). Zwei Läufe kurz hintereinander lesen und schreiben cap_wait_state (lesen → ändern → schreiben) und
-- können sich gegenseitig überschreiben. Die Funktion setzt atomar den Startzeitpunkt, wenn der letzte Lauf ≥ p_abstand_s
-- zurückliegt, und liefert dann true; sonst false (Lauf wird übersprungen).
-- Kann gefahrlos mehrfach ausgeführt werden.

create or replace function public.pv_automation_lauf_starten(p_abstand_s integer default 60)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v boolean;
begin
  insert into system_settings (key, value, updated_at)
  values ('pv_automation_lauf', jsonb_build_object('gestartet', now()), now())
  on conflict (key) do update
     set value = jsonb_build_object('gestartet', now(), 'vorher', system_settings.value->>'gestartet'),
         updated_at = now()
   where coalesce((system_settings.value->>'gestartet')::timestamptz, '-infinity'::timestamptz)
         < now() - make_interval(secs => p_abstand_s)
  returning true into v;
  return coalesce(v, false);
end $$;

revoke all on function public.pv_automation_lauf_starten(integer) from public, anon, authenticated;
grant execute on function public.pv_automation_lauf_starten(integer) to service_role;
