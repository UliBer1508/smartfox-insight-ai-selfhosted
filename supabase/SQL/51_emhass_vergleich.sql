-- 51 · EMHASS im Vergleich (22.11.2026) – doc/EMHASS-VERGLEICH-2026-11-22.md
-- Uli: „EMHASS zusätzlich einbauen und nebenher laufen lassen; wenn wir wissen, welches Modell besser ist, schalten wir es
-- scharf.“ Die Brücke auf dem Österreich-PC (C:\EMHASS\emhass_bruecke.py) rechnet jeden Morgen den Vortag mit EMHASS,
-- der Heizplaner bewertet den Plan mit demselben Maßstab wie Steuerung und Planer und schreibt ihn hierher.
alter table public.heizplan_vergleich add column if not exists emhass jsonb;
comment on column public.heizplan_vergleich.emhass is
  'EMHASS-Plan des Tages, bewertet mit unserem Raummodell: netz_kwh, netz_bereinigt_kwh, unter_grenze_gradstd, … (SQL 51)';
