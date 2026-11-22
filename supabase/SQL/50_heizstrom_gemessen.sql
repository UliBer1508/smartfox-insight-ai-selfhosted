-- 50 · „Wo stehen wir?“ – Heizstrom gemessen statt geschätzt (22.11.2026)
-- Uli: „Da wir von den Thermostaten Heizzeit und Heizstrom wissen, wissen wir doch, wie viel Strom für die Heizung
-- gebraucht wird. Aller zusätzliche Strom geht in Warmwasser, eventuell Auto, eventuell Sauna.“
-- Bisher: „davon für die Heizung“ = Netzkosten × Heizung ÷ Verbrauch (geschätzt nach Anteil).
-- Neu: Heizstrom aus dem Netz gemessen (tages_bewertung.heiz_netz_kwh bzw. protokoll_energie_raeume für den Vortag),
-- Rest Netz = Warmwasser, Auto, Sauna, Haus.

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
         -- 22.11.2026: Heizstrom nach Quelle GEMESSEN (Thermostat „heizt“ × Raumleistung, je Stunde auf PV/Batterie/Netz
         -- verteilt – protokoll_energie_raeume). Bewertete Tage aus tages_bewertung, der Vortag vor 09:55 direkt gerechnet.
         -- coalesce wertet die Unterabfrage nur aus, wenn der Tag noch nicht bewertet ist
         coalesce(t.heiz_netz_kwh, (select sum(r.netz_kwh) from protokoll_energie_raeume(e.tag) r), 0) heiz_netz,
         coalesce(t.heiz_pv_kwh, (select sum(r.pv_kwh) from protokoll_energie_raeume(e.tag) r), 0) heiz_pv,
         coalesce(t.heiz_batt_kwh, (select sum(r.batt_kwh) from protokoll_energie_raeume(e.tag) r), 0) heiz_batt,
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
         sum(heiz_netz) heiz_netz, sum(heiz_pv) heiz_pv, sum(heiz_batt) heiz_batt, sum(heiz_netz * bezug_ct / 100.0) heiz_netz_eur,
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
    'heizung_netz_eur', round(s.heiz_netz_eur, 2),                       -- gemessen (vorher: geschätzt nach Anteil)
    'heizung_netz_kwh', round(s.heiz_netz, 1), 'heizung_pv_kwh', round(s.heiz_pv, 1), 'heizung_batt_kwh', round(s.heiz_batt, 1),
    'rest_netz_kwh', round(greatest(0, s.netz - s.heiz_netz), 1),           -- Warmwasser, Auto, Sauna, Haus
    'heizung_anteil_pct', case when s.netz > 0 then round(100 * s.heiz_netz / s.netz, 0) end,
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

-- Prüfung
-- select optimierung_woche()->'summe';
