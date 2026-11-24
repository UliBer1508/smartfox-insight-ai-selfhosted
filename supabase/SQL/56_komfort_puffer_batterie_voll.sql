-- 56_komfort_puffer_batterie_voll.sql  (24.11.2026)
-- Doku: doc/FIX-KOMFORT-BUDGET-DOPPELABZUG-2026-11-24.md
--
-- Neue Einstellung für pv-automation (Code läuft auch ohne dieses Skript mit demselben Standardwert):
--   komfort_puffer_batterie_voll_w – Puffer, der bei voller Batterie (≥ 95 %) höchstens von der Einspeisung
--                                    abgezogen wird, bevor sie als Komfort-Budget gilt (300 W). Sonst gilt der
--                                    Puffer aus der Schwankung des Verbrauchs (200–1500 W).
-- Im Supabase SQL-Editor ausführen (wiederholbar).

alter table public.heating_settings
  add column if not exists komfort_puffer_batterie_voll_w numeric not null default 300;

comment on column public.heating_settings.komfort_puffer_batterie_voll_w is 'Batterie ≥ 95 %: höchstens so viel Puffer vom Komfort-Budget abziehen – die volle Batterie fängt Lastspitzen ab (SQL 56).';
