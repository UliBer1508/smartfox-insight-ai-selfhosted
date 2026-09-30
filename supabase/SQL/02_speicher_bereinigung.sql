-- ============================================================
-- 02_speicher_bereinigung.sql  (Stand 30.09.2026)
-- ============================================================
-- Problem: Datenbank 0,7 GB bei 0,5 GB Free-Limit.
-- Messung 30.09.2026:
--   cron.job_run_details             409 MB  (Protokoll jedes Cron-Laufs, nie geloescht)
--   public.room_temperature_samples  126 MB  (441.000 Zeilen)
--   public.api_errors                 51 MB  (120.000 Zeilen)
--   public.learning_events            23 MB
-- Ursache: cleanup_old_data() existiert, war aber nicht eingeplant;
-- das Cron-Protokoll wurde nie aufgeraeumt (~1.700 Laeufe pro Tag).
--
-- Dieses Skript (wiederholbar, im SQL-Editor als Ganzes ausfuehren):
--   1. loescht Cron-Protokolle aelter als 3 Tage
--   2. fuehrt cleanup_old_data() einmal sofort aus
--   3. plant beides taeglich ein (03:20 und 03:30 UTC)
--   4. zeigt am Ende die eingeplanten Aufraeum-Jobs
-- Platz freigeben (VACUUM FULL) = separater Schritt, siehe unten.
-- ============================================================

set statement_timeout = '15min';

-- 1. Cron-Protokoll kuerzen
delete from cron.job_run_details
where end_time < now() - interval '3 days'
   or (end_time is null and start_time < now() - interval '3 days');

-- 2. Fachdaten jetzt einmal bereinigen (Aufbewahrung laut Funktion:
--    Raumtemperaturen 14 Tage, api_errors 7/30 Tage, learning_events 30 Tage ...)
select public.cleanup_old_data();

-- 3. Taeglich einplanen - vorhandene gleichartige Jobs vorher entfernen
select cron.unschedule(jobid)
from cron.job
where jobname in ('daily-cleanup-old-data', 'daily-purge-cron-history')
   or command ilike '%cleanup_old_data%'
   or command ilike '%delete from cron.job_run_details%';

select cron.schedule(
  'daily-purge-cron-history',
  '20 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$
);

select cron.schedule(
  'daily-cleanup-old-data',
  '30 3 * * *',
  $$select public.cleanup_old_data()$$
);

-- 4. Kontrolle
select jobid, jobname, schedule, active
from cron.job
where jobname in ('daily-purge-cron-history', 'daily-cleanup-old-data');

-- ============================================================
-- SCHRITT B - Platz wirklich freigeben (danach, jede Zeile EINZELN ausfuehren,
-- VACUUM darf nicht zusammen mit anderen Befehlen laufen):
--
--   vacuum full cron.job_run_details;
--   vacuum full public.room_temperature_samples;
--   vacuum full public.api_errors;
--   vacuum full public.learning_events;
--
-- Ohne VACUUM FULL wird der Platz nur intern wiederverwendet; die
-- Groessenanzeige im Supabase-Dashboard sinkt erst danach.
-- Meldet cron.job_run_details "must be owner", ist das kein Problem:
-- der Platz wird dann von neuen Protokollzeilen wiederverwendet.
-- ============================================================
