-- 08_anwesenheit_uhrzeiten.sql
-- Anwesenheits-Kalender mit Monat/Woche/Tag (29.10.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md, Abschnitt 7)
-- Standard-Uhrzeiten, die der Kalender beim Antippen eines Tages einsetzt.
-- Pro Aufenthalt bleibt die Uhrzeit frei änderbar. Keine Wirkung auf pv-automation.
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz ausführen (wiederholbar).

alter table public.heating_settings
  add column if not exists presence_arrival_time time not null default '14:00',
  add column if not exists presence_departure_time time not null default '11:00';

comment on column public.heating_settings.presence_arrival_time is
  'Anwesenheits-Kalender: Standard-Uhrzeit für die Anreise beim Antippen eines Tages (nur App).';
comment on column public.heating_settings.presence_departure_time is
  'Anwesenheits-Kalender: Standard-Uhrzeit für die Abreise beim Antippen eines Tages (nur App).';

-- Kontrolle
select presence_arrival_time, presence_departure_time, presence_lead_hours from public.heating_settings limit 1;

-- Rückweg (nur falls nötig):
-- alter table public.heating_settings drop column if exists presence_arrival_time, drop column if exists presence_departure_time;
