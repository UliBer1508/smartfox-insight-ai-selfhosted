-- 41_messwerte_cache.sql (14.11.2026) – doc/FIX-PLANER-TIMEOUT-2026-11-14.md
--
-- Befund 14.11.2026: Der Heizplaner rechnet seit 13.11. 16:00 kaum noch Pläne (letzter Plan 14.11. 03:02).
-- heizplaner_daten() bricht mit „statement timeout“ ab: die Edge Function ruft es über PostgREST auf, dort gilt
-- statement_timeout = 8 s (Rolle authenticator). raum_messwerte(14) aus SQL 38 allein braucht 8–10 s
-- (Fensterfunktionen über 14 Tage room_temperature_samples). Folge: Modus „steuern“ wirkt nicht, die
-- pv-automation fällt auf das Regelwerk zurück („Plan … min alt → Regelwerk“).
--
-- Lösung: raum_messwerte wird alle 30 min von pg_cron (Rolle postgres, kein 8-s-Limit) berechnet und in
-- system_settings 'raum_messwerte_cache' abgelegt. heizplaner_daten liest nur noch den Cache (< 1 s).
-- Die Messwerte sind 14-Tage-Statistiken – 30 min Verzögerung ändern nichts.
-- Wiederholbar.

create or replace function public.raum_messwerte_cache_aktualisieren()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into system_settings (key, value, updated_at)
  values ('raum_messwerte_cache', jsonb_build_object('at', now(), 'werte', public.raum_messwerte(14)), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end
$function$;

-- Cron: alle 30 min (Minute 7 und 37, nicht auf den vollen Viertelstunden des Planers)
select cron.unschedule(jobid) from cron.job where jobname = 'raum-messwerte-cache';
select cron.schedule('raum-messwerte-cache', '7,37 * * * *', $$select public.raum_messwerte_cache_aktualisieren()$$);

-- Sofort einmal füllen
select public.raum_messwerte_cache_aktualisieren();

create or replace function public.heizplaner_daten(p_tage integer default 2)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
    -- 14.11.2026: aus dem Cache (SQL 41) statt raum_messwerte(14) direkt – sonst Timeout nach 8 s
    'messwerte', coalesce((select value->'werte' from system_settings where key = 'raum_messwerte_cache'), '{}'::jsonb),
    'pruefung', (select value from system_settings where key = 'planer_pruefung')
  );
$function$;
grant execute on function public.heizplaner_daten(int) to service_role;

-- Prüfen:
-- select value->>'at' from system_settings where key = 'raum_messwerte_cache';
-- select jobname, schedule from cron.job where jobname = 'raum-messwerte-cache';
