-- 40_min_vorrang.sql (14.11.2026) – doc/FIX-MIN-VORRANG-2026-11-14.md
--
-- Uli 14.11.2026: Kein Raum darf unter Min fallen. Räume unter Min heizen zuerst, auch über die normale Grenze
-- (max_grid_heating_power_w), aber zusammen nie über den Deckel min_deckel_w. Die Heizung startet schon bei
-- Min + min_vorlauf_c. cap_wait_boost_min hat seitdem keine Wirkung mehr (Reihenfolge = Abstand zu Min).
-- Wiederholbar.

alter table public.heating_settings add column if not exists min_deckel_w int not null default 6000;
comment on column public.heating_settings.min_deckel_w is
  'Höchstleistung für Räume unter Min (W). Gezählt wird nur Heizleistung (DP 5 heizt × Raumleistung), nicht Auto/Warmwasser. Seit 14.11.2026.';

alter table public.heating_settings add column if not exists min_vorlauf_c numeric not null default 0.2;
comment on column public.heating_settings.min_vorlauf_c is
  'Vorlauf: Heizung startet bei Min + diesem Wert (°C), damit der träge Estrich den Raum nicht unter Min fallen lässt. Seit 14.11.2026.';

comment on column public.heating_settings.cap_wait_boost_min is
  'Ohne Wirkung seit 14.11.2026 (Min hat Vorrang: Reihenfolge nach Abstand zu Min, dann Priorität).';

-- Protokoll: Änderungen der neuen Hauswerte erscheinen über trg_protokoll_haus automatisch (alle Spalten).
-- select min_deckel_w, min_vorlauf_c, max_grid_heating_power_w from heating_settings;
