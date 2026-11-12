-- 35 – Dauerhafter Energie-Verlauf je Stunde und Tag (12.11.2026, doc/VERLAUF-UND-WIRKUNG-2026-11-12.md)
--
-- Uli, 12.11.2026: „Wir benötigen Tag, Woche, Monat, Jahr, Vergleich Vorwoche, Vormonat, Vorjahr. Auch wenn wir die
-- Daten jetzt nicht haben, wir werden sie in Zukunft haben.“ – „Ich möchte die Kosten sehen für den Netzbezug.“
--
-- Warum neu: energy_readings bleibt nur 30 Tage, room_temperature_samples 14 Tage (cleanup_old_data).
-- hourly_aggregates wird seit 13.10.2026 nicht mehr geschrieben und kennt weder PV noch Batterie;
-- daily_pattern_scores liegt um etwa Faktor 10 daneben (01.11.: 1,0 statt 10,5 kWh PV). Beide werden ersetzt
-- (Entfernen mit Bereinigung Stufe 2, zusammen mit analyze-patterns, das sie liest).
--
-- energie_stunde / energie_tag werden NIE gelöscht (nicht in cleanup_old_data). Ein Jahr = ~8 800 + 365 Zeilen.
-- Gefüllt stündlich (:07) per pg_cron, ohne HTTP. Nachgetragen ab dem ältesten vorhandenen Messwert (13.10.2026).

-- ---------------------------------------------------------------- Tabellen
create table if not exists public.energie_stunde (
  stunde            timestamptz primary key,          -- Beginn der Stunde (UTC)
  pv_kwh            numeric not null default 0,
  verbrauch_kwh     numeric not null default 0,       -- Hausverbrauch laut Fronius (alles)
  heizung_kwh       numeric,                          -- „heizt“ × gemessene Raumleistung (null = keine Raumdaten)
  netz_kwh          numeric not null default 0,       -- Bezug
  einspeisung_kwh   numeric not null default 0,
  batt_laden_kwh    numeric not null default 0,
  batt_entladen_kwh numeric not null default 0,
  netz_batt_leer_kwh numeric not null default 0,      -- Bezug, solange Ladestand ≤ 6 %
  soc_min           numeric,
  soc_max           numeric,
  soc_ende          numeric,
  messwerte         integer not null default 0,
  berechnet_at      timestamptz not null default now()
);

create table if not exists public.energie_tag (
  tag               date primary key,                 -- Wiener Kalendertag
  pv_kwh            numeric, verbrauch_kwh numeric, heizung_kwh numeric,
  haus_kwh          numeric,                          -- Grundlast (gemessen, raum_leistung_messung „Grundlast“)
  rest_kwh          numeric,                          -- Warmwasser + Auto = Verbrauch − Heizung − Haus (bis gemessen)
  netz_kwh          numeric, einspeisung_kwh numeric,
  batt_laden_kwh    numeric, batt_entladen_kwh numeric, netz_batt_leer_kwh numeric,
  soc_min           numeric, soc_max numeric,
  raum_h_unter_eco  numeric,                          -- aus tages_bewertung (08–22 Uhr)
  raum_h_nacht_unter numeric,                         -- nachts unter Untergrenze
  planer_netz_kwh   numeric,                          -- Gegenrechnung des Planers bei gleicher Sonne
  bezug_ct          numeric, einspeise_ct numeric,    -- an diesem Tag gültiger Preis (energy_price_history)
  netz_kosten_eur   numeric, einspeise_erloes_eur numeric, grundgebuehr_eur numeric,
  stunden           integer not null default 0,       -- Stunden mit Messwerten (24 = vollständig)
  berechnet_at      timestamptz not null default now()
);

alter table public.energie_stunde enable row level security;
alter table public.energie_tag enable row level security;
drop policy if exists energie_stunde_lesen on public.energie_stunde;
create policy energie_stunde_lesen on public.energie_stunde for select to authenticated using (true);
drop policy if exists energie_tag_lesen on public.energie_tag;
create policy energie_tag_lesen on public.energie_tag for select to authenticated using (true);

-- ---------------------------------------------------------------- Stunden rechnen
create or replace function public.energie_stunde_rechnen(p_von timestamptz, p_bis timestamptz)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  with er as (
    select timestamp ts, coalesce(pv_power, 0) pv, coalesce(consumption, 0) c, coalesce(power_io, 0) io,
           coalesce(battery_power, 0) bp, battery_soc soc,
           least(extract(epoch from lead(timestamp) over (order by timestamp) - timestamp), 900) dt
      from energy_readings
     where timestamp >= date_trunc('hour', p_von) - interval '15 min' and timestamp < date_trunc('hour', p_bis) + interval '1 hour'
  ), e as (
    select date_trunc('hour', ts) st,
           sum(pv * dt) / 3600000.0 pv, sum(c * dt) / 3600000.0 c,
           sum(greatest(io, 0) * dt) / 3600000.0 netz, sum(greatest(-io, 0) * dt) / 3600000.0 einsp,
           sum(greatest(-bp, 0) * dt) / 3600000.0 lad, sum(greatest(bp, 0) * dt) / 3600000.0 ent,
           sum(case when soc <= 6 then greatest(io, 0) * dt else 0 end) / 3600000.0 leer,
           min(soc) smin, max(soc) smax, (array_agg(soc order by ts desc))[1] send, count(*) n
      from er where dt is not null and ts >= date_trunc('hour', p_von) and ts < date_trunc('hour', p_bis) + interval '1 hour'
     group by 1
  ), rs as (
    select s.room_id, s.timestamp ts, s.is_heating,
           least(extract(epoch from lead(s.timestamp) over (partition by s.room_id order by s.timestamp) - s.timestamp), 900) dt
      from room_temperature_samples s
     where s.timestamp >= date_trunc('hour', p_von) - interval '15 min' and s.timestamp < date_trunc('hour', p_bis) + interval '1 hour'
  ), h as (
    select date_trunc('hour', rs.ts) st, sum(coalesce(r.heating_power_w, r.calculated_power_w, 800) * rs.dt) / 3600000.0 heiz
      from rs join rooms r on r.id = rs.room_id
     where rs.is_heating and rs.dt is not null
     group by 1
  ), hr as (   -- Stunden, für die überhaupt Raumdaten da sind (sonst heizung = null statt 0)
    select distinct date_trunc('hour', ts) st from rs
  )
  insert into energie_stunde as z (stunde, pv_kwh, verbrauch_kwh, heizung_kwh, netz_kwh, einspeisung_kwh, batt_laden_kwh,
                                   batt_entladen_kwh, netz_batt_leer_kwh, soc_min, soc_max, soc_ende, messwerte, berechnet_at)
  select e.st, round(e.pv, 3), round(e.c, 3),
         case when hr.st is null then null else round(least(coalesce(h.heiz, 0), e.c), 3) end,
         round(e.netz, 3), round(e.einsp, 3), round(e.lad, 3), round(e.ent, 3), round(e.leer, 3),
         e.smin, e.smax, e.send, e.n, now()
    from e left join h on h.st = e.st left join hr on hr.st = e.st
  on conflict (stunde) do update set
    pv_kwh = excluded.pv_kwh, verbrauch_kwh = excluded.verbrauch_kwh,
    heizung_kwh = coalesce(excluded.heizung_kwh, z.heizung_kwh),   -- Raumdaten nach 14 Tagen weg: alten Wert behalten
    netz_kwh = excluded.netz_kwh, einspeisung_kwh = excluded.einspeisung_kwh, batt_laden_kwh = excluded.batt_laden_kwh,
    batt_entladen_kwh = excluded.batt_entladen_kwh, netz_batt_leer_kwh = excluded.netz_batt_leer_kwh,
    soc_min = excluded.soc_min, soc_max = excluded.soc_max, soc_ende = excluded.soc_ende,
    messwerte = excluded.messwerte, berechnet_at = now();
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---------------------------------------------------------------- Tag rechnen (aus den Stunden)
create or replace function public.energie_tag_rechnen(p_tag date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  von timestamptz := p_tag::timestamp at time zone 'Europe/Vienna';
  bis timestamptz := (p_tag + 1)::timestamp at time zone 'Europe/Vienna';
  v_grund numeric; v_bezug numeric; v_einsp numeric; v_gebuehr numeric;
begin
  select watt into v_grund from raum_leistung_messung where raum = 'Grundlast' order by gemessen_at desc limit 1;
  select electricity_price_cent, feed_in_price_cent, electricity_base_fee_year_eur into v_bezug, v_einsp, v_gebuehr
    from energy_price_history where valid_from <= p_tag and (valid_to is null or valid_to >= p_tag)
   order by valid_from desc limit 1;
  if v_bezug is null then
    select electricity_price_kwh_cent, feed_in_price_kwh_cent into v_bezug, v_einsp from heating_settings limit 1;
  end if;

  insert into energie_tag as z (tag, pv_kwh, verbrauch_kwh, heizung_kwh, haus_kwh, rest_kwh, netz_kwh, einspeisung_kwh,
      batt_laden_kwh, batt_entladen_kwh, netz_batt_leer_kwh, soc_min, soc_max, raum_h_unter_eco, raum_h_nacht_unter,
      planer_netz_kwh, bezug_ct, einspeise_ct, netz_kosten_eur, einspeise_erloes_eur, grundgebuehr_eur, stunden, berechnet_at)
  select p_tag, round(sum(s.pv_kwh), 2), round(sum(s.verbrauch_kwh), 2),
         case when count(s.heizung_kwh) = 0 then null else round(sum(coalesce(s.heizung_kwh, 0)), 2) end,
         round(sum(least(coalesce(v_grund, 240) / 1000.0, greatest(0, s.verbrauch_kwh - coalesce(s.heizung_kwh, 0)))), 2),
         case when count(s.heizung_kwh) = 0 then null else
           round(greatest(0, sum(s.verbrauch_kwh) - sum(coalesce(s.heizung_kwh, 0))
                 - sum(least(coalesce(v_grund, 240) / 1000.0, greatest(0, s.verbrauch_kwh - coalesce(s.heizung_kwh, 0))))), 2) end,
         round(sum(s.netz_kwh), 2), round(sum(s.einspeisung_kwh), 2),
         round(sum(s.batt_laden_kwh), 2), round(sum(s.batt_entladen_kwh), 2), round(sum(s.netz_batt_leer_kwh), 2),
         min(s.soc_min), max(s.soc_max),
         (select round(raum_min_unter_eco / 60.0, 1) from tages_bewertung where tag = p_tag),
         (select round(nacht_min_unter / 60.0, 1) from tages_bewertung where tag = p_tag),
         (select (planer ->> 'netz_kwh')::numeric from heizplan_vergleich where tag = p_tag),
         v_bezug, v_einsp,
         round(sum(s.netz_kwh) * coalesce(v_bezug, 0) / 100.0, 2),
         round(sum(s.einspeisung_kwh) * coalesce(v_einsp, 0) / 100.0, 2),
         round(coalesce(v_gebuehr, 0) / 365.0, 2),
         count(*), now()
    from energie_stunde s where s.stunde >= von and s.stunde < bis
  having count(*) > 0
  on conflict (tag) do update set
    pv_kwh = excluded.pv_kwh, verbrauch_kwh = excluded.verbrauch_kwh, heizung_kwh = excluded.heizung_kwh,
    haus_kwh = excluded.haus_kwh, rest_kwh = excluded.rest_kwh, netz_kwh = excluded.netz_kwh,
    einspeisung_kwh = excluded.einspeisung_kwh, batt_laden_kwh = excluded.batt_laden_kwh,
    batt_entladen_kwh = excluded.batt_entladen_kwh, netz_batt_leer_kwh = excluded.netz_batt_leer_kwh,
    soc_min = excluded.soc_min, soc_max = excluded.soc_max,
    raum_h_unter_eco = coalesce(excluded.raum_h_unter_eco, z.raum_h_unter_eco),
    raum_h_nacht_unter = coalesce(excluded.raum_h_nacht_unter, z.raum_h_nacht_unter),
    planer_netz_kwh = coalesce(excluded.planer_netz_kwh, z.planer_netz_kwh),
    bezug_ct = excluded.bezug_ct, einspeise_ct = excluded.einspeise_ct, netz_kosten_eur = excluded.netz_kosten_eur,
    einspeise_erloes_eur = excluded.einspeise_erloes_eur, grundgebuehr_eur = excluded.grundgebuehr_eur,
    stunden = excluded.stunden, berechnet_at = now();
end $function$;

-- ---------------------------------------------------------------- stündlich: letzte 3 Stunden + heute + gestern
create or replace function public.energie_verlauf_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_heute date := (now() at time zone 'Europe/Vienna')::date;
begin
  perform energie_stunde_rechnen(now() - interval '3 hours', now());
  perform energie_tag_rechnen(v_heute);
  perform energie_tag_rechnen(v_heute - 1);   -- Tagesnote (09:55) und Gegenrechnung (03:00) kommen am Folgetag
end $function$;

revoke all on function public.energie_stunde_rechnen(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.energie_tag_rechnen(date) from public, anon, authenticated;
revoke all on function public.energie_verlauf_tick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'energie-verlauf') then perform cron.unschedule('energie-verlauf'); end if;
end $$;
select cron.schedule('energie-verlauf', '7 * * * *', 'select public.energie_verlauf_tick();');

-- ---------------------------------------------------------------- Nachtragen ab dem ältesten Messwert
do $$
declare d date; v_von date;
begin
  select (min(timestamp) at time zone 'Europe/Vienna')::date into v_von from energy_readings;
  d := v_von;
  while d <= (now() at time zone 'Europe/Vienna')::date loop
    perform energie_stunde_rechnen(d::timestamp at time zone 'Europe/Vienna', (d + 1)::timestamp at time zone 'Europe/Vienna' - interval '1 hour');
    perform energie_tag_rechnen(d);
    d := d + 1;
  end loop;
end $$;

-- Prüfen
select tag, pv_kwh, verbrauch_kwh, heizung_kwh, netz_kwh, netz_kosten_eur, stunden from energie_tag order by tag desc limit 5;
