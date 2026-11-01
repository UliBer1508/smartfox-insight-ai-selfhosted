-- 16_tagesnote_komfort_fix.sql  (01.11.2026)
-- Fehler in der Tagesnote: Teil ③ Komfort war an allen Tagen 0. Die Raum-Minuten unter der Untergrenze werden über
-- ALLE Räume summiert, aber gegen 720 Minuten (= 1 Raum) gerechnet. Jetzt: Anteil an (Räume × Minuten 08–22 Uhr).
-- Beispiel 28.10.: 108 Raum-Stunden unter Untergrenze bei 14 Räumen × 14 h = 196 → 55 % → Komfort 11,2 statt 0.
-- Danach: Noten 26.–31.10. neu rechnen + Auswertung je Raum (welche Räume liegen unter ihrer Untergrenze?).

create or replace function public.tag_bewerten(p_tag date)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare
  von timestamptz := p_tag::timestamp at time zone 'Europe/Vienna';
  bis timestamptz := (p_tag + 1)::timestamp at time zone 'Europe/Vienna';
  t_von timestamptz;
  t_bis timestamptz;
  v_pv numeric; v_verbrauch numeric; v_einsp numeric; v_netz numeric;
  v_hz numeric; v_hz_pv numeric; v_hz_batt numeric; v_hz_netz numeric;
  v_soc_sun numeric; v_soc_morgen numeric; v_need numeric; v_unter numeric; v_aussen numeric; v_prog numeric;
  n1 numeric; n2 numeric; n3 numeric; n4 numeric;
  v_hint text[] := '{}';
  v_end int; v_start int; v_raeume int; v_fenster numeric;
begin
  select coalesce(extract(hour from night_end_time::time), 8), coalesce(extract(hour from night_start_time::time), 22)
    into v_end, v_start from heating_settings limit 1;
  t_von := (p_tag + make_interval(hours => v_end))::timestamp at time zone 'Europe/Vienna';
  t_bis := (p_tag + make_interval(hours => v_start))::timestamp at time zone 'Europe/Vienna';

  -- Energie (zeitgewichtet, Lücken > 15 min nicht hochgerechnet)
  select round(sum(coalesce(pv_power, 0) * dt) / 3600000.0, 2),
         round(sum(coalesce(consumption, 0) * dt) / 3600000.0, 2),
         round(sum(greatest(-power_io, 0) * dt) / 3600000.0, 2),
         round(sum(greatest(power_io, 0) * dt) / 3600000.0, 2)
    into v_pv, v_verbrauch, v_einsp, v_netz
  from (select pv_power, consumption, power_io,
               least(extract(epoch from lead(timestamp) over (order by timestamp) - timestamp), 900) as dt
        from energy_readings where timestamp >= von and timestamp < bis) x
  where dt is not null;

  if v_pv is null then
    insert into tages_bewertung (tag, hinweis, bewertet_at) values (p_tag, 'keine Energiedaten (nur 7 Tage gespeichert)', now())
    on conflict (tag) do update set hinweis = excluded.hinweis, bewertet_at = now();
    return null;
  end if;

  select round(sum(kwh), 2), round(sum(pv_kwh), 2), round(sum(batt_kwh), 2), round(sum(netz_kwh), 2)
    into v_hz, v_hz_pv, v_hz_batt, v_hz_netz
  from protokoll_energie_raeume(p_tag);

  -- Ladestand bei Sonnenuntergang = letzter Messwert mit PV ≥ 300 W, sonst 17:00
  select battery_soc into v_soc_sun from energy_readings
   where timestamp >= von and timestamp < bis and pv_power >= 300 and battery_soc is not null
   order by timestamp desc limit 1;
  if v_soc_sun is null then
    select battery_soc into v_soc_sun from energy_readings
     where timestamp <= (p_tag + time '17:00') at time zone 'Europe/Vienna' and timestamp >= von
     order by timestamp desc limit 1;
  end if;

  select max(soc_morgens) into v_soc_morgen from nacht_protokoll where nacht = p_tag;

  -- Nachtbedarf: größter Verlust der 7 Nächte davor (nur Nächte mit Ladestand abends ≥ 20 %)
  select max(soc_abends - soc_morgens) into v_need from (
    select distinct nacht, soc_abends, soc_morgens from nacht_protokoll
    where nacht between p_tag - 7 and p_tag - 1 and soc_abends >= 20 and soc_morgens is not null) n;
  v_need := coalesce(v_need, 21);

  -- Raum-Minuten unter Untergrenze, 08–22 Uhr (Untergrenze leer = Eco − 1,5)
  select round(sum(dt) / 60.0) into v_unter from (
    select s.temperature, coalesce(r.wait_min_temp, r.eco_temp - 1.5) as grenze,
           least(extract(epoch from lead(s.timestamp) over (partition by s.room_id order by s.timestamp) - s.timestamp), 900) as dt
    from room_temperature_samples s join rooms r on r.id = s.room_id
    where s.timestamp >= t_von and s.timestamp < t_bis and r.automation_enabled is not false) x
  where dt is not null and temperature < grenze - 0.05;
  v_unter := coalesce(v_unter, 0);
  -- Bezug: alle Räume mit Messwerten × Minuten im Fenster (08–22 Uhr = 840) – v_unter ist die Summe über alle Räume
  select count(distinct s.room_id) into v_raeume from room_temperature_samples s join rooms r on r.id = s.room_id
   where s.timestamp >= t_von and s.timestamp < t_bis and r.automation_enabled is not false;
  v_fenster := greatest(1, extract(epoch from t_bis - t_von) / 60.0) * greatest(1, coalesce(v_raeume, 1));

  -- weather_data speichert Wiener Ortszeit als UTC
  select round(avg(temperature_c)::numeric, 1) into v_aussen from weather_data
   where (timestamp at time zone 'UTC') >= p_tag::timestamp and (timestamp at time zone 'UTC') < (p_tag + 1)::timestamp;
  select expected_kwh into v_prog from pv_forecasts where date = p_tag;

  -- Teilnoten
  -- ① Nacht: gereicht (≥ 8 % am Morgen) = 25; sonst nach Ladestand bei Sonnenuntergang gegen Bedarf,
  --   bei leerer Batterie am Morgen höchstens 12,5
  if v_soc_morgen is not null and v_soc_morgen >= 8 then n1 := 25;
  elsif v_soc_sun is not null then
    n1 := round(25 * least(1, greatest(0, (v_soc_sun - 5) / (v_need + 15))), 1);
    if v_soc_morgen is not null then n1 := least(n1, 12.5); end if;
  else n1 := null; end if;
  if v_soc_morgen is not null and v_soc_morgen < 8 then v_hint := v_hint || 'Batterie vor dem Morgen leer'::text; end if;

  n2 := case when v_pv < 1 then 25 else round(25 * greatest(0, least(1, (v_pv - v_einsp) / v_pv)), 1) end;
  if v_einsp > 2 then v_hint := v_hint || (replace(v_einsp::text, '.', ',') || ' kWh eingespeist'); end if;

  n3 := round(25 * greatest(0, 1 - v_unter / v_fenster), 1);
  if v_unter > 120 then v_hint := v_hint || (round(v_unter / 60.0, 1)::text || ' Raum-Stunden unter Untergrenze'); end if;

  n4 := round(25 * greatest(0, 1 - coalesce(v_hz_netz, 0) / 5.0), 1);
  if coalesce(v_hz_batt, 0) > 2 then v_hint := v_hint || (replace(v_hz_batt::text, '.', ',') || ' kWh Heizung aus Batterie'); end if;
  if p_tag < date '2026-10-26' then v_hint := v_hint || 'vor Datenbeginn (Thermostate im Modus auto)'::text; end if;

  insert into tages_bewertung (tag, pv_kwh, verbrauch_kwh, einspeisung_kwh, netz_kwh, heizung_kwh, heiz_pv_kwh, heiz_batt_kwh, heiz_netz_kwh,
                               soc_sonnenuntergang, soc_morgen, nachtbedarf_pct, raum_min_unter, aussen_avg, pv_prognose_kwh,
                               n_nacht, n_sonne, n_komfort, n_netz, note, hinweis, bewertet_at)
  values (p_tag, v_pv, v_verbrauch, v_einsp, v_netz, v_hz, v_hz_pv, v_hz_batt, v_hz_netz,
          round(v_soc_sun, 1), round(v_soc_morgen, 1), round(v_need, 1), v_unter, v_aussen, v_prog,
          n1, n2, n3, n4, round(coalesce(n1, 0) + n2 + n3 + n4), nullif(array_to_string(v_hint, ' · '), ''), now())
  on conflict (tag) do update set
    pv_kwh = excluded.pv_kwh, verbrauch_kwh = excluded.verbrauch_kwh, einspeisung_kwh = excluded.einspeisung_kwh,
    netz_kwh = excluded.netz_kwh, heizung_kwh = excluded.heizung_kwh, heiz_pv_kwh = excluded.heiz_pv_kwh,
    heiz_batt_kwh = excluded.heiz_batt_kwh, heiz_netz_kwh = excluded.heiz_netz_kwh,
    soc_sonnenuntergang = excluded.soc_sonnenuntergang, soc_morgen = excluded.soc_morgen, nachtbedarf_pct = excluded.nachtbedarf_pct,
    raum_min_unter = excluded.raum_min_unter, aussen_avg = excluded.aussen_avg, pv_prognose_kwh = excluded.pv_prognose_kwh,
    n_nacht = excluded.n_nacht, n_sonne = excluded.n_sonne, n_komfort = excluded.n_komfort, n_netz = excluded.n_netz,
    note = excluded.note, hinweis = excluded.hinweis, bewertet_at = now();

  perform protokoll_add('einstellung', null,
    'Tagesnote ' || to_char(p_tag, 'DD.MM.') || ': ' || round(coalesce(n1, 0) + n2 + n3 + n4) || '/100',
    'Nacht ' || coalesce(n1::text, '–') || ' · Sonne ' || n2 || ' · Komfort ' || n3 || ' · Netz ' || n4
      || coalesce(' · ' || nullif(array_to_string(v_hint, ' · '), ''), ''),
    jsonb_build_object('tag', p_tag));
  return round(coalesce(n1, 0) + n2 + n3 + n4);
end $$;

grant execute on function public.tag_bewerten(date) to authenticated;

-- Noten neu rechnen (Einstellungen bleiben, wie sie sind)
do $$
declare d date;
begin
  for d in select tag from public.tages_bewertung order by tag loop
    begin
      perform public.tag_bewerten(d);
      if d < date '2026-11-01' then
        update public.tages_bewertung set hinweis = concat_ws(' · ', hinweis, 'Einstellungen nachgetragen (Stand 01.11.)') where tag = d;
      end if;
    exception when others then raise notice 'tag_bewerten % übersprungen: %', d, sqlerrm;
    end;
  end loop;
end $$;

select tag, note, n_nacht, n_sonne, n_komfort, n_netz, raum_min_unter, hinweis from public.tages_bewertung order by tag;

-- Je Raum: Stunden unter der Untergrenze (08–22 Uhr), 26.–31.10., mit tiefstem Wert
select r.name as raum, r.priority as prio, coalesce(r.wait_min_temp, r.eco_temp - 1.5) as untergrenze, r.eco_temp as eco,
       round(sum(x.dt) filter (where x.temperature < coalesce(r.wait_min_temp, r.eco_temp - 1.5) - 0.05) / 3600.0, 1) as stunden_unter,
       round(min(x.temperature)::numeric, 1) as tiefster_wert,
       round(avg(x.temperature)::numeric, 1) as mittel
from (
  select s.room_id, s.temperature,
         least(extract(epoch from lead(s.timestamp) over (partition by s.room_id order by s.timestamp) - s.timestamp), 900) as dt,
         (s.timestamp at time zone 'Europe/Vienna') as lokal
  from public.room_temperature_samples s
  where s.timestamp >= timestamp '2026-10-26' at time zone 'Europe/Vienna'
    and s.timestamp <  timestamp '2026-11-01' at time zone 'Europe/Vienna') x
join public.rooms r on r.id = x.room_id
where extract(hour from x.lokal) between 8 and 21 and x.dt is not null and r.automation_enabled is not false
group by r.name, r.priority, r.wait_min_temp, r.eco_temp
order by stunden_unter desc nulls last;
