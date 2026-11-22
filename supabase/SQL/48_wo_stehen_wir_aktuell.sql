-- 48 · „Wo stehen wir?“ – Zahlen aktuell und vollständig (22.11.2026)
-- Doku: doc/FIX-WO-STEHEN-WIR-AKTUELL-2026-11-22.md
--
-- Uli (22.11.2026): „Diese Zahlen werden scheinbar nicht upgedated.“
-- Befund: Kosten/kWh kommen stündlich (energie_tag, Cron :07) und waren aktuell. Nicht aktuell bzw. lückenhaft:
--   1. tag_bewerten speichert nacht_min_unter = NULL statt 0, wenn kein Raum nachts unter Min lag (18., 19.11.)
--      → diese Nächte fehlen, „Ø je Nacht“ wurde trotzdem durch 7 geteilt.
--   2. Der Vortag wird erst um 09:55 bewertet (Außentemperatur, Raum-Stunden). Bis dahin fehlte er bei
--      Heizgradtag und Raum-Stunden, wurde aber in „Ø je Tag/Nacht“ mitgezählt.
-- Lösung: (1) NULL → 0 in tag_bewerten + Nachtrag; (2) optimierung_woche nimmt die Außentemperatur notfalls direkt
-- aus weather_data, liefert die Zahl der Tage mit Raumwerten und den Datenstand.

-- 1 · tag_bewerten: Nacht ohne Unterschreitung = 0 (nicht NULL). Nur diese eine Zeile wird ergänzt.
do $$
declare v_def text; v_alt text; v_neu text;
begin
  v_def := pg_get_functiondef('public.tag_bewerten(date)'::regprocedure);
  if position('v_nacht_unter := coalesce(v_nacht_unter, 0)' in v_def) > 0 then
    raise notice 'tag_bewerten schon angepasst'; return;
  end if;
  v_alt := E'and r.automation_enabled is not false;\r\n  v_nacht_fenster';
  if position(v_alt in v_def) = 0 then v_alt := E'and r.automation_enabled is not false;\n  v_nacht_fenster'; end if;
  if position(v_alt in v_def) = 0 then raise exception 'tag_bewerten: Stelle nicht gefunden – nicht geändert'; end if;
  v_neu := replace(v_alt, '  v_nacht_fenster',
    E'  if coalesce(v_nacht_raeume, 0) > 0 then v_nacht_unter := coalesce(v_nacht_unter, 0); end if;  -- 22.11.2026\n  v_nacht_fenster');
  execute replace(v_def, v_alt, v_neu);
end $$;

-- Nachtrag: bewertete Nächte ohne Unterschreitung (Nacht-Note vorhanden) auf 0, energie_tag nachziehen
update tages_bewertung set nacht_min_unter = 0
 where nacht_min_unter is null and n_nacht is not null;
update energie_tag e set raum_h_nacht_unter = round(t.nacht_min_unter / 60.0, 1)
  from tages_bewertung t
 where t.tag = e.tag and e.raum_h_nacht_unter is null and t.nacht_min_unter is not null;

-- 2 · optimierung_woche: Außentemperatur-Ersatz, Tage mit Raumwerten, Datenstand
create or replace function public.optimierung_woche(p_bis date default null, p_tage integer default 7)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
with grenzen as (
  select coalesce(p_bis, (now() at time zone 'Europe/Vienna')::date - 1) as bis,
         greatest(1, least(coalesce(p_tage, 7), 92)) as n
),
basis as (
  select e.tag,
         coalesce(e.pv_kwh, 0) pv, coalesce(e.verbrauch_kwh, 0) verbrauch, coalesce(e.heizung_kwh, 0) heizung,
         coalesce(e.netz_kwh, 0) netz, coalesce(e.einspeisung_kwh, 0) einsp,
         coalesce(e.netz_kosten_eur, 0) netz_eur, coalesce(e.einspeise_erloes_eur, 0) einsp_eur,
         coalesce(e.bezug_ct, 0) bezug_ct, coalesce(e.netz_batt_leer_kwh, 0) netz_leer,
         e.raum_h_nacht_unter h_unter_min, e.raum_h_unter_eco h_unter_normal, e.stunden,
         a.aussen,
         greatest(0, 18 - a.aussen) hgt
  from energie_tag e
  left join tages_bewertung t on t.tag = e.tag
  -- 22.11.2026: Vortag ist erst um 09:55 bewertet – bis dahin Außentemperatur direkt aus weather_data (Ortszeit als UTC)
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
         sum(netz_eur) netz_eur, sum(einsp_eur) einsp_eur, sum(netz_leer) netz_leer,
         sum(verbrauch * bezug_ct / 100.0) ohne_pv_eur,
         sum(h_unter_min) h_unter_min, sum(h_unter_normal) h_unter_normal,
         count(h_unter_min) tage_min, count(h_unter_normal) tage_normal,
         sum(heizung) filter (where hgt > 0) heiz_hgt_kwh, sum(hgt) filter (where hgt > 0) hgt,
         min(tag) von, max(tag) bis
  from zeitraum
),
wochen as (
  select k, min(b.tag) von, max(b.tag) bis,
         sum(b.heizung) filter (where b.hgt > 0) / nullif(sum(b.hgt) filter (where b.hgt > 0), 0) kwh_je_hgt,
         sum(b.netz_eur) netz_eur, count(*) tage
  from grenzen g
  cross join generate_series(0, 7) k
  join basis b on b.tag > g.bis - g.n * (k + 1) and b.tag <= g.bis - g.n * k
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
    'netz_eur', round(s.netz_eur, 2), 'einspeise_eur', round(s.einsp_eur, 2),
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

-- Prüfung
-- select tag, nacht_min_unter, n_nacht from tages_bewertung where tag >= current_date - 7 order by tag;
-- select jsonb_pretty(optimierung_woche() - 'tage_liste' - 'wochen');
