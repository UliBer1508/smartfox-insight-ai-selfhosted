-- 09_abwesenheit_umdrehen.sql
-- Anwesenheit umgedreht (01.11.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md, Abschnitt 9)
-- Grundzustand ist jetzt ANWESEND. Einträge in presence_periods bedeuten ab jetzt ABWESENHEIT
-- (Haus leer von start_at bis end_at, Vorlauf presence_lead_hours vor end_at).
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz ausführen (wiederholbar).
-- Reihenfolge: dieses SQL → supabase functions deploy pv-automation → App (Vercel).
-- Hinweis: Zwischen SQL und Deploy liest die alte pv-automation einen leeren Kalender als "abwesend".
--          Deshalb SQL und Deploy direkt nacheinander, oder vorher "Anwesenheit steuern" aus lassen.

-- 1. Bisherige Einträge waren Aufenthalte ("ich bin da") – umgedreht würden sie falsch gelesen.
--    Zur Kontrolle vorher anzeigen, dann löschen.
select start_at at time zone 'Europe/Vienna' as von, end_at at time zone 'Europe/Vienna' as bis, note, source
from public.presence_periods order by start_at;

delete from public.presence_periods;

-- 2. Bedeutung dokumentieren
comment on table public.presence_periods is
  'Abwesenheit: Zeiträume, in denen das Haus leer ist. Außerhalb gilt anwesend (umgedreht 01.11.2026).';
comment on column public.heating_settings.presence_control_enabled is
  'Abwesenheit steuern: an = während Kalender-Einträgen gilt abwesend (Wartetag, PV bis Komfort). Aus = immer anwesend.';
comment on column public.heating_settings.presence_lead_hours is
  'Vorlauf in Stunden: so lange vor dem Ende einer Abwesenheit gilt schon wieder "anwesend".';
comment on column public.heating_settings.presence_arrival_time is
  'Kalender: Standard-Uhrzeit der Rückkehr beim Antippen eines Tages (nur App).';
comment on column public.heating_settings.presence_departure_time is
  'Kalender: Standard-Uhrzeit der Abreise beim Antippen eines Tages (nur App).';

-- 3. Steuerung einschalten – mit leerem Kalender heißt das: anwesend
update public.heating_settings set presence_control_enabled = true;

-- Kontrolle
select count(*) as eintraege from public.presence_periods;
select presence_control_enabled, presence_lead_hours, presence_arrival_time, presence_departure_time
from public.heating_settings limit 1;
