-- 53 · Planer mit HiGHS als Prüfstein (22.11.2026) – doc/FIX-PLANER-HIGHS-2026-11-22.md
-- Uli: „Warum verbessern wir unseren Algorithmus nicht um dieses HiGHS-Modell?“ – „Also spielen wir den Code in
-- Österreich ein.“ Gleiches Raummodell, gleiche Regeln und Kosten wie der Planer, aber vollständige Optimierung statt
-- gieriger Suche. Gelöst auf dem Österreich-PC (Brücke, highspy), bewertet vom Heizplaner (Aktion highs_bewerten).
alter table public.heizplan_vergleich add column if not exists planer_highs jsonb;
comment on column public.heizplan_vergleich.planer_highs is
  'Unser Planer mit HiGHS statt gieriger Suche (gelöst auf dem Österreich-PC), bewertet wie planer: netz_kwh, netz_bereinigt_kwh, kosten, … (SQL 53)';
