-- 49 · „Wo stehen wir?“ nach Woche/Monat/Jahr + Abgleich mit der Salzburg-AG-Rechnung (22.11.2026)
-- Doku: doc/FIX-WO-STEHEN-WIR-AKTUELL-2026-11-22.md
--
-- Uli (22.11.2026): „Ich möchte, dass die Daten täglich upgedated werden. Ich möchte sehen, wie sie sich ändern pro
-- Woche, Monat, Jahr.“ – „Und ich möchte, dass du die Rechnung der Salzburg AG dazu vergleichst.“
--
-- 1. optimierung_woche: Zeitraum bis 400 Tage (Jahr), Grundgebühr in der Summe; 'wochen' bleibt für die alte Anzeige,
--    die neue nutzt optimierung_verlauf.
-- 2. optimierung_verlauf(einheit, bis, anzahl): je Woche (Mo–So) oder Monat die Kennzahlen für den Verlauf.
-- 3. stromrechnung: Monatswerte der Salzburg AG (Verbrauchs- und Abrechnungsinformation), Abgleich je Monat.

-- 1 · optimierung_woche ------------------------------------------------------------------------------------------
create or replace function public.optimierung_woche(p_bis date default null, p_tage integer default 7)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
with grenzen as (
  select coalesce(p_bis, (now() at time zone 'Europe/Vienna')::date - 1) as bis,
         greatest(1, least(coalesce(p_tage, 7), 400)) as n
),
basis as (
  select e.tag,
         coalesce(e.pv_kwh, 0) pv, coalesce(e.verbrauch_kwh, 0) verbrauch, coalesce(e.heizung_kwh, 0) heizung,
         coalesce(e.netz_kwh, 0) netz, coalesce(e.einspeisung_kwh, 0) einsp,
         coalesce(e.netz_kosten_eur, 0) netz_eur, coalesce(e.einspeise_erloes_eur, 0) einsp_eur,
         coalesce(e.bezug_ct, 0) bezug_ct, coalesce(e.netz_batt_leer_kwh, 0) netz_leer,
         coalesce(e.grundgebuehr_eur, 0) grund_eur,
         e.raum_h_nacht_unter h_unter_min, e.raum_h_unter_eco h_unter_normal,
         greatest(0, 18 - a.aussen) hgt, a.aussen
  from energie_tag e
  left join tages_bewertung t on t.tag = e.tag
  -- Vortag ist erst um 09:55 bewertet – bis dahin Außentemperatur direkt aus weather_data (Ortszeit als UTC)
  cross join lateral (select coalesce(t.aussen_avg, (
      select round(avg(w.temperature_c)::numeric, 1) from weather_data w
       where (w.timestamp at time zone 'UTC') >= e.tag::timestamp and (w.timestamp at time zone 'UTC') < (e.tag + 1)::timestamp
    )) as aussen) a
  where coalesce(e.stunden, 24) >= 20
),
zeitraum as (
  select b.* from basis b, grenzen g where b.tag > g.bis - g.n and b.tag <= g.bis
),
summe as (
  select count(*) tage,
         sum(pv) pv, sum(verbrauch) verbrauch, sum(heizung) heizung, sum(netz) netz, sum(einsp) einsp,
         sum(netz_eur) netz_eur, sum(einsp_eur) einsp_eur, sum(netz_leer) netz_leer, sum(grund_eur) grund_eur,
         sum(verbrauch * bezug_ct / 100.0) ohne_pv_eur,
         sum(h_unter_min) h_unter_min, sum(h_unter_normal) h_unter_normal,
         count(h_unter_min) tage_min, count(h_unter_normal) tage_normal,
         sum(heizung) filter (where hgt > 0) heiz_hgt_kwh, sum(hgt) filter (where hgt > 0) hgt,
         min(tag) von, max(tag) bis
  from zeitraum
),
wochen as (   -- nur für ältere Anzeige (bis SQL 48); neu: optimierung_verlauf
  select k, min(b.tag) von, max(b.tag) bis,
         sum(b.heizung) filter (where b.hgt > 0) / nullif(sum(b.hgt) filter (where b.hgt > 0), 0) kwh_je_hgt,
         sum(b.netz_eur) netz_eur, count(*) tage
  from grenzen g
  cross join generate_series(0, 7) k
  join basis b on b.tag > g.bis - least(g.n, 31) * (k + 1) and b.tag <= g.bis - least(g.n, 31) * k
  group by k
)
select jsonb_build_object(
  'von', s.von, 'bis', s.bis, 'tage', s.tage,
  'tage_min', s.tage_min, 'tage_normal', s.tage_normal,
  'stand', (select max(berechnet_at) from energie_tag),
  'bewertet_bis', (select max(tag) from tages_bewertung where bewertet_at is not null and note is not null),
  'summe', jsonb_build_object(
    'pv_kwh', round(s.pv, 1), 'verbrauch_kwh', round(s.verbrauch, 1), 'heizung_kwh', round(s.heizung, 1),
    'netz_kwh', round(s.netz, 1), 'einspeisung_kwh', round(s.einsp, 2), 'netz_leer_kwh', round(s.netz_leer, 1),
    'eigen_pct', case when s.pv > 0 then round(100 * (s.pv - s.einsp) / s.pv, 1) end,
    'netz_eur', round(s.netz_eur, 2), 'einspeise_eur', round(s.einsp_eur, 2), 'grund_eur', round(s.grund_eur, 2),
    'ohne_pv_eur', round(s.ohne_pv_eur, 2),
    'pv_ersparnis_eur', round(s.ohne_pv_eur - s.netz_eur + s.einsp_eur, 2),
    'heizung_netz_eur', case when s.verbrauch > 0 then round(s.netz_eur * s.heizung / s.verbrauch, 2) end,
    'heizung_anteil_pct', case when s.verbrauch > 0 then round(100 * s.heizung / s.verbrauch, 0) end,
    'kwh_je_hgt', round(s.heiz_hgt_kwh / nullif(s.hgt, 0), 2),
    'h_unter_min', round(s.h_unter_min, 1),
    'h_unter_normal', round(s.h_unter_normal, 0)
  ),
  'tage_liste', coalesce((select jsonb_agg(jsonb_build_object(
      'tag', z.tag, 'pv', round(z.pv, 1), 'verbrauch', round(z.verbrauch, 1), 'heizung', round(z.heizung, 1),
      'netz', round(z.netz, 1), 'netz_eur', round(z.netz_eur, 2), 'aussen', round(z.aussen::numeric, 1),
      'hgt', round(z.hgt::numeric, 1),
      'kwh_je_hgt', case when z.hgt > 0 then round((z.heizung / z.hgt)::numeric, 2) end,
      'h_unter_min', round(z.h_unter_min, 1), 'h_unter_normal', round(z.h_unter_normal, 0)) order by z.tag) from zeitraum z), '[]'::jsonb),
  'wochen', coalesce((select jsonb_agg(jsonb_build_object(
      'von', w.von, 'bis', w.bis, 'tage', w.tage,
      'kwh_je_hgt', round(w.kwh_je_hgt::numeric, 2), 'netz_eur', round(w.netz_eur, 2)) order by w.k desc) from wochen w), '[]'::jsonb),
  'ziel', (select value from system_settings where key = 'optimierung_ziel'),
  'planer_modus', (select planer_modus from heating_settings limit 1)
)
from summe s;
$function$;

-- 2 · optimierung_verlauf ----------------------------------------------------------------------------------------
-- Je Woche (Mo–So) oder Kalendermonat bis p_bis (inkl.), die letzten p_anzahl Zeiträume. Nur volle Tage (≥ 20 h).
create or replace function public.optimierung_verlauf(p_einheit text default 'woche', p_bis date default null, p_anzahl integer default 8)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
with g as (
  select case when p_einheit = 'monat' then 'month' else 'week' end as feld,
         coalesce(p_bis, (now() at time zone 'Europe/Vienna')::date - 1) as bis,
         greatest(1, least(coalesce(p_anzahl, 8), 36)) as n
),
grenze as (
  select feld, bis, (date_trunc(feld, bis) - ((n - 1) || ' ' || feld)::interval)::date as von from g
),
basis as (
  select date_trunc(gr.feld, e.tag)::date as beginn, e.tag,
         coalesce(e.heizung_kwh, 0) heizung, coalesce(e.netz_kwh, 0) netz, coalesce(e.netz_kosten_eur, 0) netz_eur,
         coalesce(e.pv_kwh, 0) pv, coalesce(e.einspeisung_kwh, 0) einsp,
         e.raum_h_nacht_unter h_min,
         greatest(0, 18 - coalesce(t.aussen_avg, (
           select avg(w.temperature_c) from weather_data w
            where (w.timestamp at time zone 'UTC') >= e.tag::timestamp and (w.timestamp at time zone 'UTC') < (e.tag + 1)::timestamp))) hgt
  from grenze gr
  join energie_tag e on e.tag >= gr.von and e.tag <= gr.bis
  left join tages_bewertung t on t.tag = e.tag
  where coalesce(e.stunden, 24) >= 20
)
select coalesce(jsonb_agg(jsonb_build_object(
    'von', beginn, 'bis', bis, 'tage', tage,
    'kwh_je_hgt', round(kwh_je_hgt::numeric, 2),
    'netz_kwh', round(netz, 1), 'netz_eur', round(netz_eur, 2),
    'netz_eur_je_tag', round(netz_eur / tage, 2),
    'eigen_pct', case when pv > 0 then round(100 * (pv - einsp) / pv, 1) end,
    'h_min_je_nacht', round(h_min / nullif(tage_min, 0), 1)) order by beginn), '[]'::jsonb)
from (
  select beginn, max(tag) bis, count(*) tage,
         sum(heizung) filter (where hgt > 0) / nullif(sum(hgt) filter (where hgt > 0), 0) kwh_je_hgt,
         sum(netz) netz, sum(netz_eur) netz_eur, sum(pv) pv, sum(einsp) einsp,
         sum(h_min) h_min, count(h_min) tage_min
  from basis group by beginn
) x;
$function$;

-- 3 · stromrechnung ----------------------------------------------------------------------------------------------
create table if not exists public.stromrechnung (
  monat date primary key,                       -- 1. des Monats
  kwh numeric not null,                         -- Netzbezug lt. Salzburg AG (ermittelt oder geschätzt)
  gesamt_eur numeric,                           -- Gesamtkosten Strom inkl. Steuern, Abgaben, Netz
  energie_eur numeric, netz_eur numeric, abgaben_eur numeric,
  arbeitspreis_ct numeric, grundpreis_monat_eur numeric,
  quelle text,
  created_at timestamptz default now()
);
comment on table public.stromrechnung is 'Monatswerte der Salzburg AG (Verbrauchs- und Abrechnungsinformation) für den Abgleich in Auto-Steuerung › Wo stehen wir? (SQL 49, 22.11.2026)';
alter table public.stromrechnung enable row level security;
drop policy if exists stromrechnung_lesen on public.stromrechnung;
create policy stromrechnung_lesen on public.stromrechnung for select to authenticated using (true);

insert into public.stromrechnung (monat, kwh, gesamt_eur, energie_eur, netz_eur, abgaben_eur, arbeitspreis_ct, grundpreis_monat_eur, quelle) values
  ('2026-10-01', 99.10, 32.16, 14.74, 13.77, 3.65, 20.28, 3.00, 'Verbrauchs- und Abrechnungsinfo Okt. 2026 vom 18.11.2026'),
  ('2025-10-01', 127.67, null, null, null, null, null, null, 'Vorjahreswert aus Verbrauchs- und Abrechnungsinfo Okt. 2026')
on conflict (monat) do update set kwh = excluded.kwh, gesamt_eur = excluded.gesamt_eur, energie_eur = excluded.energie_eur,
  netz_eur = excluded.netz_eur, abgaben_eur = excluded.abgaben_eur, arbeitspreis_ct = excluded.arbeitspreis_ct,
  grundpreis_monat_eur = excluded.grundpreis_monat_eur, quelle = excluded.quelle;

-- Abgleich je Monat: Rechnung gegen App (energie_tag). App-Kosten = Netz-kWh × 29,94 ct + Grundgebühr je Tag.
create or replace function public.stromrechnung_abgleich()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
select coalesce(jsonb_agg(jsonb_build_object(
    'monat', r.monat, 'tage_monat', extract(day from (r.monat + interval '1 month' - interval '1 day'))::int,
    'rechnung_kwh', r.kwh, 'rechnung_eur', r.gesamt_eur,
    'rechnung_ct_kwh', case when r.kwh > 0 and r.gesamt_eur is not null then round(100 * r.gesamt_eur / r.kwh, 1) end,
    'app_tage', a.tage, 'app_kwh', round(a.netz, 1), 'app_eur', round(a.eur + a.grund, 2),
    'app_ct_kwh', case when a.netz > 0 then round(100 * (a.eur + a.grund) / a.netz, 1) end,
    'quelle', r.quelle) order by r.monat desc), '[]'::jsonb)
from stromrechnung r
left join lateral (
  select count(*) tage, sum(netz_kwh) netz, sum(netz_kosten_eur) eur, sum(grundgebuehr_eur) grund
  from energie_tag where tag >= r.monat and tag < r.monat + interval '1 month'
) a on true;
$function$;

-- Prüfung
-- select jsonb_pretty(optimierung_woche(date '2026-11-21', 21) - 'tage_liste');
-- select jsonb_pretty(optimierung_verlauf('woche', null, 8));
-- select jsonb_pretty(optimierung_verlauf('monat', null, 12));
-- select jsonb_pretty(stromrechnung_abgleich());
