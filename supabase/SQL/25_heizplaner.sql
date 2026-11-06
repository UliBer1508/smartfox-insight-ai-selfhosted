-- 25_heizplaner.sql  (06.11.2026)
-- doc/KONZEPT-PLANER-2026-11-06.md – Uli: „Wir haben eine KI, die mit allen verfügbaren Werten evaluieren soll,
-- welches das beste Heizungsmodell ist. Was wir hier machen, ist ständig fixe Werte zu definieren, die meist
-- nicht funktionieren.“ → „dieses Konzept umsetzen“.
--
-- Planer im SCHATTENBETRIEB: rechnet alle 15 min einen 24-h-Plan und zeigt ihn, steuert aber NICHTS.
--
--  1) heizmodell          – gelerntes Raummodell je Raum (täglich 03:00)
--  2) heizplan            – je Lauf der Plan für 24 h (3 Tage aufbewahrt)
--  3) heizplan_vergleich  – je Tag Gegenrechnung: heutige Steuerung vs. Planer bei gleicher Sonne
--  4) heizplaner_daten()  – alle Eingaben in einem JSON-Wert (keine 1000-Zeilen-Grenze)
--  5) heating_settings    – Modus und Gewichte des Planers
--
-- Im Supabase SQL-Editor ausführen (wiederholbar). Danach Edge Functions heizplaner und analysis-scheduler deployen.

-- 1) Raummodell ----------------------------------------------------------------------------------------------
create table if not exists public.heizmodell (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  raum        text not null,
  param       jsonb not null,            -- {k, g, s, c, tau}: Auskühlen/h, Aufheizen °C/h, Sonne °C/h/kW, innere Wärme °C/h, Estrich h
  fehler_12h  numeric,                   -- mittlere Abweichung nach 12 h (°C)
  gleich_12h  numeric,                   -- zum Vergleich: Annahme „Temperatur bleibt gleich“
  heiz_std    numeric,                   -- so viele Stunden hat der Raum im Lernzeitraum geheizt
  prior       boolean not null default false,   -- wenig eigene Daten → an die anderen Räume angelehnt
  tage        int,
  gelernt_at  timestamptz not null default now()
);
comment on table public.heizmodell is 'Heizplaner (06.11.2026): gelerntes Raummodell je Raum, täglich 03:00 (heizplaner?aktion=lernen).';

-- 2) Pläne ---------------------------------------------------------------------------------------------------
create table if not exists public.heizplan (
  id            bigserial primary key,
  erstellt_at   timestamptz not null default now(),
  start_at      timestamptz not null,           -- Beginn des ersten 15-min-Slots
  modus         text not null default 'schatten',
  plan          jsonb not null,                 -- je Raum Heizen/Temperatur je Slot, PV/Netz/Batterie je Slot
  jetzt         jsonb,                          -- je Raum: Planer würde jetzt heizen? Steuerung heizt?
  pv_kwh        numeric, heiz_kwh numeric, netz_kwh numeric, einspeis_kwh numeric,
  unter_ziel_gradstd numeric, unter_grenze_gradstd numeric,
  nachfuehrung  numeric                         -- PV-Nachführfaktor (gemessen/vorhergesagt)
);
create index if not exists heizplan_at_idx on public.heizplan (erstellt_at desc);
comment on table public.heizplan is 'Heizplaner: 24-h-Plan je Lauf (alle 15 min), im Schattenbetrieb nur zur Anzeige.';

-- 3) Gegenrechnung je Tag ----------------------------------------------------------------------------------------
create table if not exists public.heizplan_vergleich (
  tag              date primary key,
  netz_gemessen_kwh numeric,           -- tatsächlicher Netzbezug (Fronius)
  steuerung        jsonb,              -- heutige Steuerung, im Modell nachgerechnet: heiz/netz kWh, °C·h unter Ziel/Untergrenze
  planer           jsonb,              -- Planer bei gleicher Sonne, gleichem Wetter, gleichem Start
  planer_gleich    jsonb,              -- Planer bei gleichem Komfort wie die Steuerung (fairer Netzvergleich)
  modell_abw       numeric,            -- Modell mit echter Heizung vs. gemessene Temperaturen (°C)
  erstellt_at      timestamptz not null default now()
);
comment on table public.heizplan_vergleich is 'Heizplaner: Gegenrechnung des Vortags (täglich 03:00).';

do $$ declare t text; begin
  foreach t in array array['heizmodell','heizplan','heizplan_vergleich'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Authenticated read" on public.%I', t);
    execute format('create policy "Authenticated read" on public.%I for select to authenticated using (auth.uid() is not null)', t);
  end loop;
end $$;

-- 4) Eingaben für Lernen und Planen ------------------------------------------------------------------------------
-- Zeiten: Messwerte als Epoch-Sekunden (UTC) auf 15 min gerundet; Wetter und PV je Stunde als Wiener Ortszeit
-- „YYYY-MM-DD HH“ (weather_data.timestamp enthält die Wiener Ortszeit, als UTC gespeichert).
create or replace function public.heizplaner_daten(p_tage int default 2)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with von as (select now() - make_interval(days => p_tage) as t)
  select jsonb_build_object(
    'jetzt', extract(epoch from now())::bigint,
    'settings', (select to_jsonb(h) from (select night_start_time, night_end_time, max_grid_heating_power_w, battery_capacity_kwh,
                   electricity_price_kwh_cent, feed_in_price_kwh_cent, planer_modus, planer_gewicht_ziel, planer_gewicht_unter,
                   planer_sicherheit_abstand, eco_temp, night_temp from heating_settings limit 1) h),
    'grundlast', (select watt from raum_leistung_messung where raum = 'Grundlast' order by gemessen_at desc limit 1),
    'raeume', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'p', coalesce(calculated_power_w, heating_power_w),
                 'prio', priority, 'eco', eco_temp, 'nacht', night_temp, 'unter', wait_min_temp, 'komfort', comfort_temp,
                 'pvmax', pv_boost_max_temp, 't', current_temp, 'heizt', is_heating, 'soll', target_temp,
                 'auto', automation_enabled, 'manuell_bis', manual_override_until) order by priority)
               from rooms where tuya_device_id is not null),
    'modell', (select jsonb_object_agg(room_id, jsonb_build_object('param', param, 'heiz_std', heiz_std, 'prior', prior)) from heizmodell),
    'pv_modell', (select value from system_settings where key = 'planer_pv_modell'),
    'energie15', (select jsonb_agg(jsonb_build_array(b, c, pv, soc, netz) order by b) from (
        select (floor(extract(epoch from timestamp) / 900) * 900)::bigint b, round(avg(consumption)) c, round(avg(pv_power)) pv,
               round(avg(battery_soc)::numeric, 1) soc, round(avg(power_io)) netz
        from energy_readings, von where timestamp > von.t group by 1) e),
    'samples15', (select jsonb_object_agg(room_id, arr) from (
        select room_id, jsonb_agg(jsonb_build_array(b, t, h) order by b) arr from (
          select room_id, (floor(extract(epoch from timestamp) / 900) * 900)::bigint b,
                 round(avg(temperature)::numeric, 2) t, round(avg(is_heating::int)::numeric, 2) h
          from room_temperature_samples, von where timestamp > von.t - interval '12 hours' group by 1, 2) s group by room_id) z),
    'wetter', (select jsonb_agg(jsonb_build_array(to_char(timestamp, 'YYYY-MM-DD HH24'), round(coalesce(direct_radiation_wm2, 0)),
                 round(coalesce(diffuse_radiation_wm2, 0)), temperature_c) order by timestamp)
               from weather_data, von where timestamp > (von.t at time zone 'Europe/Vienna') - interval '1 day'),
    'pv_h', (select jsonb_agg(jsonb_build_array(to_char(h, 'YYYY-MM-DD HH24'), pv) order by h) from (
        select date_trunc('hour', timestamp at time zone 'Europe/Vienna') h, round(avg(pv_power)) pv
        from energy_readings where timestamp > now() - make_interval(days => greatest(p_tage, 30)) group by 1) x)
  );
$$;
grant execute on function public.heizplaner_daten(int) to service_role;

-- 5) Einstellungen ---------------------------------------------------------------------------------------------
alter table public.heating_settings add column if not exists planer_modus text not null default 'schatten';
alter table public.heating_settings add column if not exists planer_gewicht_ziel numeric not null default 0.6;
alter table public.heating_settings add column if not exists planer_gewicht_unter numeric not null default 2.0;
alter table public.heating_settings add column if not exists planer_sicherheit_abstand numeric not null default 1.5;
comment on column public.heating_settings.planer_modus is 'Heizplaner: aus | schatten (rechnet und zeigt, steuert nicht). Steuern kommt erst nach Freigabe.';
comment on column public.heating_settings.planer_gewicht_ziel is 'Heizplaner: so viele kWh Netzstrom ist 1 °C·h unter dem Ziel (Eco tags, Nachtwert nachts) wert.';
comment on column public.heating_settings.planer_gewicht_unter is 'Heizplaner: so viele kWh Netzstrom ist 1 °C·h unter der Untergrenze wert (zusätzlich).';
comment on column public.heating_settings.planer_sicherheit_abstand is 'Heizplaner: so weit unter der Untergrenze darf ein Raum nie fallen (°C).';

-- Kontrolle
select jsonb_array_length(public.heizplaner_daten(2) -> 'energie15') as energie15,
       jsonb_array_length(public.heizplaner_daten(2) -> 'wetter') as wetter;
