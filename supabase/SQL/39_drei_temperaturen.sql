-- 39_drei_temperaturen.sql (14.11.2026) – doc/FIX-DREI-TEMPERATUREN-2026-11-14.md
--
-- Uli 14.11.2026: Je Raum gibt es nur noch drei Temperaturen:
--   Min     (rooms.wait_min_temp)  – darf nie unterschritten werden, Tag und Nacht
--   Normal  (rooms.eco_temp)       – Ziel tagsüber
--   PV-Max  (rooms.comfort_temp)   – bis hierhin wird mit PV-Überschuss geheizt
--
-- Der alte Nachtwert (rooms.night_temp) ist kein eigener Wert mehr. Die Spalte bleibt, weil pv-automation,
-- heizplaner, compute-daily-score und Oberfläche sie lesen – sie wird ab jetzt immer gleich Min gehalten.
-- Alle Leser rechnen nachts schon mit max(night_temp, wait_min_temp), das ergibt damit überall Min.
--
-- 1) Daten: Min = höherer der beiden bisherigen Werte (nachts galt schon max(Nacht, Untergrenze),
--    der Raum wird dadurch nirgends kälter). Betrifft am 14.11. nur Toilette Eingang (21 → 21,5).
-- 2) Trigger: night_temp folgt immer wait_min_temp. Ändert jemand nur night_temp (alter Code), wird das als
--    neuer Min-Wert übernommen.
-- 3) Protokoll: Labels Min / Normal / PV-Max, night_temp wird nicht mehr doppelt protokolliert.
-- Wiederholbar.

-- 1) Daten angleichen
update public.rooms
set wait_min_temp = greatest(coalesce(wait_min_temp, night_temp), coalesce(night_temp, wait_min_temp)),
    night_temp    = greatest(coalesce(wait_min_temp, night_temp), coalesce(night_temp, wait_min_temp))
where wait_min_temp is distinct from night_temp;

-- 2) Gleichlauf night_temp = wait_min_temp
create or replace function public.trg_min_gleich_nacht()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE'
     and new.night_temp is distinct from old.night_temp
     and new.wait_min_temp is not distinct from old.wait_min_temp then
    new.wait_min_temp := new.night_temp;          -- nur Nachtwert geändert → das ist der neue Min-Wert
  end if;
  if new.wait_min_temp is null then
    new.wait_min_temp := new.night_temp;
  end if;
  new.night_temp := new.wait_min_temp;
  return new;
end
$function$;

-- Name beginnt mit z_, damit er nach protect_rooms_sensitive_columns läuft (BEFORE-Trigger laufen alphabetisch)
drop trigger if exists z_trg_min_gleich_nacht on public.rooms;
create trigger z_trg_min_gleich_nacht
  before insert or update of night_temp, wait_min_temp on public.rooms
  for each row execute function public.trg_min_gleich_nacht();

-- 3) Protokoll mit den neuen Namen
create or replace function public.trg_protokoll_raum()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
  k text; teile text[] := '{}';
  labels jsonb := '{"wait_min_temp":"Min","eco_temp":"Normal","comfort_temp":"PV-Max",
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
end
$function$;

-- Whitelist-Text für KI-Vorschläge
update public.ai_parameter_whitelist
set description = 'Min je Raum (darf nie unterschritten werden, Tag und Nacht). Laut Konzept nur Normal − 2 … Normal vorschlagen'
where parameter_key = 'wait_min_temp';

-- Prüfen: alle Räume night_temp = wait_min_temp
-- select name, wait_min_temp as min, eco_temp as normal, comfort_temp as pv_max, night_temp from rooms order by priority;
