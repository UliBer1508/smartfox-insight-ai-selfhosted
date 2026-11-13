-- 38_planer_pruefung.sql (13.11.2026) – doc/FIX-PLANER-PRUEFUNG-2026-11-13.md
--
-- Der Planer prüft jeden Plan gegen das, was wir je Raum GEMESSEN haben (nicht gegen sein eigenes Modell):
--   auf_k_h      – wie schnell der FÜHLER beim Heizen wärmer wird (°C je Heizstunde, Median, Höchstwert bis 90 min nach
--                  dem Abschalten). Achtung: der Fühler wird beim Heizen kurz warm und fällt danach zurück – nur zur Anzeige.
--   auf_dauer_k_h – was davon bleibt: Temperatur 100–140 min nach dem Heizen minus vorher, je Heizstunde (Median, nur
--                  Blöcke ohne erneutes Heizen in den 4 h danach). Damit rechnet die Prüfung. n_dauer = Anzahl Blöcke.
--   heiz_dauer   – typische Länge eines Heizblocks (h, Median)
--   heiz_h_tag   – wie viele Stunden der Raum an den letzten 14 vollen Tagen im Mittel geheizt hat
--   tin / tout   – mittlere Raum- und Außentemperatur derselben Tage (um den Bedarf auf heute umzurechnen)
--   unter_eco    – Anteil der Zeit 08–22 Uhr der letzten 3 Tage, in der der Raum mehr als 0,3 °C unter Eco lag
--   heiz_h_3t    – Heizstunden je Tag der letzten 3 Tage
--   uebersteuert – wie oft Uli den Raum in den letzten 24 h von Hand übersteuert hat
-- Nur lesen, keine Tabelle. heizplaner_daten() liefert das als 'messwerte' mit. Wiederholbar.

create or replace function public.raum_messwerte(p_tage int default 14)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with s0 as (
    select room_id, timestamp ts, temperature t, coalesce(is_heating, false) h,
           lag(coalesce(is_heating, false)) over (partition by room_id order by timestamp) hv
    from room_temperature_samples
    where timestamp > now() - make_interval(days => p_tage) and fuehler_sonne is not true and temperature is not null
  ), s as (
    select *, sum(case when h <> coalesce(hv, not h) then 1 else 0 end) over (partition by room_id order by ts) seg from s0
  ), seg as (
    select room_id, seg, min(ts) t0, max(ts) t1, (array_agg(t order by ts))[1] ta
    from s where h group by 1, 2
  ), heiz as (
    select g.room_id, extract(epoch from g.t1 - g.t0) / 3600 + 1 / 12.0 dauer,
           (select max(x.t) from s x where x.room_id = g.room_id and x.ts between g.t0 and g.t1 + interval '90 min') - g.ta anstieg,
           (select avg(x.t) from s x where x.room_id = g.room_id and x.ts between g.t1 + interval '100 min' and g.t1 + interval '140 min') - g.ta bleibt,
           not coalesce((select bool_or(x.h) from s x where x.room_id = g.room_id and x.ts > g.t1 + interval '6 min' and x.ts < g.t1 + interval '4 hours'), true) allein
    from seg g where g.t1 > g.t0
  ), tag as (
    select room_id, (ts at time zone 'Europe/Vienna')::date d, avg(h::int) * 24 heiz_h, avg(t) tin
    from s group by 1, 2
  ), aussen as (
    select (timestamp)::date d, avg(temperature_c) tout from weather_data
    where timestamp > (now() at time zone 'Europe/Vienna') - make_interval(days => p_tage + 1) group by 1
  ), voll as (
    select t.room_id, avg(t.heiz_h) heiz_h, avg(t.tin) tin, avg(a.tout) tout
    from tag t left join aussen a on a.d = t.d
    where t.d < (now() at time zone 'Europe/Vienna')::date group by 1
  ), drei as (
    select x.room_id,
           avg(case when x.t < r.eco_temp - 0.3 then 1.0 else 0.0 end)
             filter (where extract(hour from x.ts at time zone 'Europe/Vienna') between 8 and 21) unter_eco,
           avg(x.h::int) * 24 heiz_h
    from s x join rooms r on r.id = x.room_id
    where x.ts > now() - interval '3 days' group by 1
  ), manuell as (
    select room_id, count(*) n from protokoll_events
    where ts > now() - interval '24 hours' and kind = 'einstellung' and detail = 'Übersteuern' group by 1
  )
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object(
      'n_heiz', (select count(*) from heiz h where h.room_id = r.id and h.dauer >= 0.2),
      'auf_k_h', (select round((percentile_cont(0.5) within group (order by h.anstieg / h.dauer))::numeric, 2)
                    from heiz h where h.room_id = r.id and h.dauer >= 0.2),
      'auf_dauer_k_h', (select round((percentile_cont(0.5) within group (order by h.bleibt / h.dauer))::numeric, 2)
                          from heiz h where h.room_id = r.id and h.dauer >= 0.2 and h.allein and h.bleibt is not null),
      'n_dauer', (select count(*) from heiz h where h.room_id = r.id and h.dauer >= 0.2 and h.allein and h.bleibt is not null),
      'heiz_dauer', (select round((percentile_cont(0.5) within group (order by h.dauer))::numeric, 2)
                       from heiz h where h.room_id = r.id and h.dauer >= 0.2),
      'heiz_h_tag', round(v.heiz_h::numeric, 2), 'tin', round(v.tin::numeric, 1), 'tout', round(v.tout::numeric, 1),
      'unter_eco', round(d.unter_eco::numeric, 2), 'heiz_h_3t', round(d.heiz_h::numeric, 2),
      'uebersteuert', coalesce(m.n, 0))), '{}'::jsonb)
  from rooms r
  left join voll v on v.room_id = r.id
  left join drei d on d.room_id = r.id
  left join manuell m on m.room_id = r.id
  where r.tuya_device_id is not null;
$function$;
grant execute on function public.raum_messwerte(int) to service_role;

-- heizplaner_daten wie bisher (SQL 25, Stand 13.11.2026) + 'messwerte'
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
    'messwerte', public.raum_messwerte(14),
    'pruefung', (select value from system_settings where key = 'planer_pruefung')
  );
$function$;
grant execute on function public.heizplaner_daten(int) to service_role;

-- Prüfen:
-- select jsonb_pretty(public.raum_messwerte(14));
