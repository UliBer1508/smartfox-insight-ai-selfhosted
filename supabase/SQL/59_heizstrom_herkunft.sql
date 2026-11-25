-- 59_heizstrom_herkunft.sql  (25.11.2026)
-- Doku: doc/HEIZUNG-JETZT-WIE-MUENCHEN-2026-11-25.md
--
-- Karte „Heizung jetzt“: Woher kommt der Heizstrom? (Sonne / Akku / Netz) für Heute, Woche, Monat, Jahr –
-- gleicher Aufbau wie Heizung München (muc_heizstrom_seit). Uli 24.11.2026: beide Systeme sollen gleich sein.
--
-- Rechnung je Stunde aus energie_stunde (dauerhaft, SQL 35), anteilig wie protokoll_energie_raeume (SQL 11):
--   Netz  = Heizung × Netzbezug / Verbrauch
--   Akku  = Heizung × Batterie-Entladung / Verbrauch
--   Sonne = Heizung − Netz − Akku
-- Ab p_von 00:00 (Wien) bis zur letzten gerechneten Stunde. Den Rest seit dieser Stunde rechnet die Karte live dazu.
-- Im Supabase SQL-Editor ausführen (wiederholbar).

create or replace function public.heizstrom_herkunft(p_von date)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with h as (
    select s.stunde, coalesce(s.heizung_kwh, 0) as heiz,
           case when s.verbrauch_kwh > 0 then least(1, s.netz_kwh / s.verbrauch_kwh) else 0 end as f_netz,
           case when s.verbrauch_kwh > 0 then least(1, s.batt_entladen_kwh / s.verbrauch_kwh) else 0 end as f_akku
      from energie_stunde s
     where s.stunde >= (p_von::timestamp at time zone 'Europe/Vienna')
  ), a as (
    select heiz, least(1, f_netz) as fn, least(1 - least(1, f_netz), f_akku) as fa, stunde from h
  )
  select jsonb_build_object(
    'von', (min(stunde) at time zone 'Europe/Vienna')::date,
    'bis', max(stunde) + interval '1 hour',
    'tage', count(distinct (stunde at time zone 'Europe/Vienna')::date),
    'heat_kwh', round(coalesce(sum(heiz), 0), 1),
    'heat_pv_kwh', round(coalesce(sum(heiz * (1 - fn - fa)), 0), 1),
    'heat_bat_kwh', round(coalesce(sum(heiz * fa), 0), 1),
    'heat_grid_kwh', round(coalesce(sum(heiz * fn), 0), 1),
    'heute_kwh', round(coalesce(sum(heiz) filter (where (stunde at time zone 'Europe/Vienna')::date = (now() at time zone 'Europe/Vienna')::date), 0), 2))
  from a;
$$;

revoke all on function public.heizstrom_herkunft(date) from public, anon;
grant execute on function public.heizstrom_herkunft(date) to authenticated, service_role;

comment on function public.heizstrom_herkunft(date) is 'Heizstrom ab p_von nach Herkunft Sonne/Akku/Netz, anteilig je Stunde aus energie_stunde (SQL 59).';

-- Prüfen:
--   select heizstrom_herkunft((now() at time zone 'Europe/Vienna')::date);
--   select heizstrom_herkunft(date_trunc('month', now() at time zone 'Europe/Vienna')::date);
