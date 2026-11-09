-- 29_vorrang_schaltband.sql  (09.11.2026)
-- Doku: doc/FIX-VORRANG-UND-SCHALTBAND-2026-11-09.md
--
-- Zwei neue Einstellungen für pv-automation (Code läuft auch ohne dieses Skript mit denselben Standardwerten):
--   cap_keep_max_min       – wie lange ein Raum, der Leistung hat und heizt, sie höchstens am Stück behält (120 min)
--   ziel_abschalt_ueber_c  – ein heizender Raum wird abgeschaltet, sobald er sein Ziel um so viel überschritten hat
--                            (0,3 °C) – sonst heizt das Thermostat bis Ziel + Schaltband (DP 101, 1,0 °C)
-- Im Supabase SQL-Editor ausführen (wiederholbar).

alter table public.heating_settings
  add column if not exists cap_keep_max_min numeric not null default 120,
  add column if not exists ziel_abschalt_ueber_c numeric not null default 0.3;

comment on column public.heating_settings.cap_keep_max_min is 'Wer Leistung hat und heizt, behält sie bis zum Ziel – höchstens so viele Minuten am Stück (SQL 29).';
comment on column public.heating_settings.ziel_abschalt_ueber_c is 'Heizender Raum wird abgeschaltet, sobald Ist ≥ Ziel + dieser Wert (statt Ziel + Schaltband) (SQL 29).';
