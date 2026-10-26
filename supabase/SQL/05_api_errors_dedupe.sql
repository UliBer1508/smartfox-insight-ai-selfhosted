-- ============================================================
-- 05_api_errors_dedupe.sql  (Stand 26.10.2026)
-- ============================================================
-- Problem: Ein offline stehender Thermostat erzeugt alle 5 Minuten einen NEUEN Eintrag in
-- api_errors (26.10.: Wirtschaftsraum 8 offene Eintraege in 35 Minuten).
-- Der lokale Dienst (logDeviceError, Fix 16.09.) sucht zwar zuerst einen offenen Eintrag und
-- zaehlt dann nur retry_count hoch - aber der anon-Schluessel hat auf api_errors nur
-- INSERT- und UPDATE-Policies, KEINE SELECT-Policy. Die Suche liefert deshalb still eine leere
-- Liste (RLS), und der Dienst fuegt jedes Mal neu ein.
-- Nebenwirkung: Auch UPDATEs des Dienstes mit WHERE-Bedingung (z. B. "Fehler aufloesen, wenn das
-- Geraet wieder da ist") sehen keine Zeilen. Das Aufloesen erledigt auto-resolve-api-errors.
--
-- Loesung: BEFORE-INSERT-Trigger (SECURITY DEFINER, sieht alle Zeilen unabhaengig von RLS).
-- Gibt es fuer dasselbe Geraet und denselben Fehlertyp schon einen offenen Eintrag, wird dort
-- retry_count hochgezaehlt und die Meldung aktualisiert - der neue Eintrag entfaellt.
-- Keine neue Berechtigung fuer anon (der Schluessel ist oeffentlich), keine Aenderung am Dienst.
-- Gilt nur fuer Eintraege MIT device_id; alle anderen Quellen bleiben unveraendert.
--
-- Wiederholbar. Rueckweg:
--   drop trigger if exists trg_api_errors_dedupe on public.api_errors;
-- ============================================================

create or replace function public.api_errors_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if new.device_id is null or new.resolved_at is not null then
    return new;
  end if;

  select id into v_id
  from public.api_errors
  where device_id = new.device_id
    and error_type = new.error_type
    and resolved_at is null
  order by created_at desc
  limit 1;

  if v_id is null then
    return new;                       -- erster offener Eintrag: normal einfuegen
  end if;

  update public.api_errors
     set retry_count   = coalesce(retry_count, 0) + 1,
         error_message = coalesce(new.error_message, error_message),
         room_id       = coalesce(room_id, new.room_id)
   where id = v_id;
  return null;                        -- doppelten Eintrag verwerfen
exception when others then
  raise warning 'api_errors_dedupe: %', sqlerrm;
  return new;                         -- im Zweifel lieber doppelt als verloren
end;
$function$;

drop trigger if exists trg_api_errors_dedupe on public.api_errors;
create trigger trg_api_errors_dedupe
  before insert on public.api_errors
  for each row execute function public.api_errors_dedupe();

-- Einmalig: bestehende Doppelte schliessen, je Geraet + Fehlertyp bleibt der NEUESTE offen
with ranked as (
  select id, row_number() over (partition by device_id, error_type order by created_at desc) as rn
  from public.api_errors
  where resolved_at is null and device_id is not null
)
update public.api_errors e
   set resolved_at = now()
  from ranked r
 where e.id = r.id and r.rn > 1;

-- Kontrolle: je Geraet + Fehlertyp hoechstens ein offener Eintrag
select room_name, error_type, source, count(*) as offen, max(retry_count) as wiederholungen
from public.api_errors
where resolved_at is null
group by 1, 2, 3
order by 4 desc;
