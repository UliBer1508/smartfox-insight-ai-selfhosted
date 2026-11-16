-- 45 – Heizplaner: Regeln als Rahmen (16.11.2026, doc/FIX-REGELN-RAHMEN-FUER-PLANER-2026-11-16.md)
-- heizplaner_daten liefert zusätzlich:
--   settings.heating_min_battery_soc  – Sonnentag: die Sonne lädt zuerst die Batterie bis zu diesem Stand
--   settings.latitude / longitude     – Sonnenuntergang (Rückfall, wenn pv_forecasts keinen Wert hat)
--   sonnenuntergang                    – pv_forecasts.sunset je Tag (wie die Steuerung: ab Sonnenuntergang Nachtlogik)
-- Sonst unverändert gegenüber SQL 38/41.

CREATE OR REPLACE FUNCTION public.heizplaner_daten(p_tage integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with von as (select now() - make_interval(days => p_tage) as t)
  select jsonb_build_object(
    'jetzt', extract(epoch from now())::bigint,
    'settings', (select to_jsonb(h) from (select night_start_time, night_end_time, max_grid_heating_power_w, battery_capacity_kwh,
                   electricity_price_kwh_cent, feed_in_price_kwh_cent, planer_modus, planer_gewicht_ziel, planer_gewicht_unter,
                   planer_sicherheit_abstand, eco_temp, night_temp, min_deckel_w, min_vorlauf_c,
                   heating_min_battery_soc, latitude, longitude from heating_settings limit 1) h),
    'grundlast', (select watt from raum_leistung_messung where raum = 'Grundlast' order by gemessen_at desc limit 1),
    'raeume', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'p', coalesce(calculated_power_w, heating_power_w),
                 'prio', priority, 'eco', eco_temp, 'nacht', night_temp, 'unter', wait_min_temp, 'komfort', comfort_temp,
                 'pvmax', pv_boost_max_temp, 't', current_temp, 'heizt', is_heating, 'soll', target_temp,
                 'auto', automation_enabled, 'manuell_bis', manual_override_until) order by priority)
               from rooms where tuya_device_id is not null),
    'modell', (select jsonb_object_agg(room_id, jsonb_build_object('param', param, 'heiz_std', heiz_std, 'prior', prior, 'gelernt_at', gelernt_at)) from heizmodell),
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
        from energy_readings where timestamp > now() - make_interval(days => greatest(p_tage, 30)) group by 1) x),
    'messwerte', coalesce((select value->'werte' from system_settings where key = 'raum_messwerte_cache'), '{}'::jsonb),
    'pruefung', (select value from system_settings where key = 'planer_pruefung'),
    'sonnenuntergang', (select jsonb_object_agg(d, s) from (
        select distinct on (date) date::text d, sunset::text s from pv_forecasts
        where date >= current_date - p_tage - 1 and sunset is not null order by date, created_at desc) x)
  );
$function$;
