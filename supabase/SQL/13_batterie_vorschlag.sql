-- 13_batterie_vorschlag.sql  (01.11.2026)
-- Batterie-Vorschlag v2: Mindest-Ladestand = gemessener Nachtbedarf + Abend/Morgen ohne PV + Reserve
-- (Konzept Tagesablauf §10). Neuer Einstellwert für die Reserve.
-- Im Supabase SQL-Editor ausführen (wiederholbar). Danach: supabase functions deploy ai-parameter-advisor

alter table public.heating_settings
  add column if not exists battery_night_reserve_pct numeric not null default 10;

comment on column public.heating_settings.battery_night_reserve_pct is
  'Batterie-Vorschlag: Reserve in % über dem gemessenen Nachtbedarf (enthält den Mindest-Ladestand des Wechselrichters ~5 %). Standard 10.';

-- Kontrolle
select heating_min_battery_soc, battery_night_reserve_pct, battery_soc_suggestion_enabled from public.heating_settings limit 1;
