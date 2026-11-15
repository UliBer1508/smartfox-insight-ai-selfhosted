-- 44_optimierung_woche.sql (15.11.2026) – doc/OPTIMIERUNG-UEBERSICHT-2026-11-15.md
-- Auto-Steuerung › 1 „Wo stehen wir?“: eine Abfrage liefert alles für die Seite.
--   - je Tag: PV, Verbrauch, Heizung, Netz, Kosten, Außentemperatur, Heizgradtag, kWh je Heizgradtag,
--     Raum-Stunden unter Min (nachts) und unter Normal (08–22 Uhr)
--   - Summen für den Zeitraum: Kosten ohne PV, Ersparnis durch PV, Netzkosten, Anteil Heizung (geschätzt)
--   - Verlauf: kWh je Heizgradtag für die letzten 8 Zeiträume gleicher Länge (Wochen)
--   - Ziel aus system_settings „optimierung_ziel“ ({"kwh_je_hgt": 2.0}), Planer-Modus
-- Heizgradtag hier: max(0, 18 °C − Tagesmittel außen) – einfache, wetterunabhängige Vergleichsgröße.
-- Quelle Außentemperatur: tages_bewertung.aussen_avg. Wiederholbar.

insert into public.system_settings (key, value)
values ('optimierung_ziel', '{"kwh_je_hgt": 2.0, "gesetzt": "2026-11-15", "hinweis": "Vorschlag: 20 % unter 2,5 (Woche 09.–14.11.)"}'::jsonb)
on conflict (key) do nothing;

create or replace function public.optimierung_woche(p_bis date default null, p_tage int default 7)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
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
         t.aussen_avg aussen,
         greatest(0, 18 - t.aussen_avg) hgt
  from energie_tag e
  left join tages_bewertung t on t.tag = e.tag
  where coalesce(e.stunden, 24) >= 20      -- nur volle Tage
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
$$;

comment on function public.optimierung_woche(date, int) is
  'Auto-Steuerung › Wo stehen wir? (15.11.2026, SQL 44): Kosten, PV-Ersparnis, kWh je Heizgradtag, Stunden unter Min für p_tage Tage bis p_bis (Standard gestern) plus 8 Zeiträume Verlauf.';
revoke all on function public.optimierung_woche(date, int) from public, anon;
grant execute on function public.optimierung_woche(date, int) to authenticated, service_role;

-- Prüfen:
--   select jsonb_pretty(optimierung_woche('2026-11-14', 6));
