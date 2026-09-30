-- ============================================================
-- 03_cron_takt_5min.sql  (Stand 30.09.2026)
-- ============================================================
-- Problem: Log-Ingestion bei 97 % des Free-Limits (1 GB/Monat).
-- Messung 30.09.2026 (24 h): 47.600 API-Aufrufe, 8.100 Postgres-, 3.100
-- Edge-Function-Log-Eintraege. Groesster Anteil: pv-automation und
-- evaluate-decision liefen alle 2 Minuten, obwohl neue Energiedaten nur alle
-- 5 Minuten kommen (Polling-Intervall 300 s) - 2-3 Laeufe auf denselben Daten.
--
-- Aenderung: beide Jobs auf alle 5 Minuten. Zusaetzlich stoesst der lokale
-- Collector pv-automation direkt nach jedem neuen Messwert an (unveraendert).
-- Wiederholbar. Zurueck auf 2 Minuten: '*/5' unten durch '*/2' ersetzen.
-- ============================================================

select cron.alter_job(jobid, schedule := '*/5 * * * *')
from cron.job
where jobname in ('pv-automation-check', 'evaluate-decision-batch');

-- Kontrolle: alle Jobs, die haeufiger als alle 5 Minuten laufen, plus die zwei geaenderten
select jobid, jobname, schedule, active
from cron.job
where schedule like '*/1 %' or schedule like '*/2 %' or schedule like '*/3 %'
   or schedule like '*/4 %' or schedule = '* * * * *'
   or jobname in ('pv-automation-check', 'evaluate-decision-batch')
order by jobname;
