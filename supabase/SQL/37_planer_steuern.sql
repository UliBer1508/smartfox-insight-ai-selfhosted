-- 37_planer_steuern.sql (13.11.2026) – doc/FIX-PLANER-MODELL-2026-11-13.md
-- Verlauf und Wirkung: „Netz mit Planer“ ist jetzt das Netz des Planers, bereinigt um die Wärme, die er am Tagesende
-- mehr im Estrich hat als die tatsächliche Steuerung (heizplan_vergleich.planer.netz_bereinigt_kwh). Ohne diese
-- Bereinigung sah ein Plan, der den Estrich leert, sparsam aus. Ältere Tage ohne den Wert: wie bisher netz_kwh.
-- Nur eine Zeile in energie_tag_rechnen geändert (SQL 35), sonst unverändert. Wiederholbar.

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
         (select coalesce((planer ->> 'netz_bereinigt_kwh')::numeric, (planer ->> 'netz_kwh')::numeric)
            from heizplan_vergleich where tag = p_tag),
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

comment on column public.heating_settings.planer_modus is
  'Heizplaner: aus | schatten (rechnet und zeigt, steuert nicht) | steuern (pv-automation setzt die Sollwerte nach dem Plan, seit 13.11.2026).';
