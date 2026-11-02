-- 17_eco_ziel.sql  (02.11.2026)
-- Uli 02.11.2026: „Eco ist das Ziel. Wir können nicht nur auf PV bauen. Wenn PV da ist, soll sie zu 100 % genutzt werden.“
-- Fester Stromtarif. Konzept: doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md §2, §3.4, §3.7; doc/KONZEPT-RAUMMODELL-2026-11-02.md
--
-- 1) Untergrenze ist eine harte Grenze: kein Notfall-Abstand mehr im Batterie-Schutz (1,0 → 0 °C).
-- 2) Tagesnote misst an Ulis Zielen:
--    ① Nacht   = Räume nachts über ihrer Untergrenze (vorher: Batterie bis zum Morgen)
--    ③ Komfort = Räume tagsüber auf Eco (vorher: nur über Untergrenze)
--    ④ Netz    = nur Netzbezug in Stunden mit gleichzeitiger Einspeisung (vorher: jede kWh Heizung aus dem Netz)
--    ② Sonne bleibt (Anteil der PV, der im Haus genutzt wird).
-- Im SQL-Editor ausführen (Projekt pflnniklvqbwjwrjswaz). Danach pv-automation deployen.

-- 1) Notfall-Abstand
alter table public.heating_settings alter column battery_gate_floor_delta set default 0;
update public.heating_settings set battery_gate_floor_delta = 0;

-- 2) Tagesnote
alter table public.tages_bewertung
  add column if not exists raum_min_unter_eco numeric,
  add column if not exists nacht_min_unter numeric,
  add column if not exists netz_bei_einspeisung_kwh numeric;
comment on column public.tages_bewertung.raum_min_unter_eco is 'Raum-Minuten unter Eco − 0,3 °C, 08–22 Uhr (seit 02.11.2026 Grundlage Komfort-Note)';
comment on column public.tages_bewertung.nacht_min_unter is 'Raum-Minuten unter Untergrenze in der Nacht dieses Tages (seit 02.11.2026 Grundlage Nacht-Note)';
comment on column public.tages_bewertung.netz_bei_einspeisung_kwh is 'Netzbezug in Stunden mit gleichzeitiger Einspeisung (seit 02.11.2026 Grundlage Netz-Note)';

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
  v_unter_eco numeric; v_nacht_unter numeric; v_nacht_fenster numeric; v_nacht_raeume int; v_netz_einsp numeric;
  n_von timestamptz; n_bis timestamptz;
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

  -- NEU 02.11.2026: Raum-Minuten unter Eco (Ziel), 08–22 Uhr, Toleranz 0,3 °C
  select round(sum(dt) / 60.0) into v_unter_eco from (
    select s.temperature, r.eco_temp as grenze,
           least(extract(epoch from lead(s.timestamp) over (partition by s.room_id order by s.timestamp) - s.timestamp), 900) as dt
    from room_temperature_samples s join rooms r on r.id = s.room_id
    where s.timestamp >= t_von and s.timestamp < t_bis and r.automation_enabled is not false and r.eco_temp is not null) x
  where dt is not null and temperature < grenze - 0.3;
  v_unter_eco := coalesce(v_unter_eco, 0);

  -- NEU 02.11.2026: Nacht dieses Tages (night_start → night_end am Folgetag): Raum-Minuten unter Untergrenze
  n_von := (p_tag + make_interval(hours => v_start))::timestamp at time zone 'Europe/Vienna';
  n_bis := (p_tag + 1 + make_interval(hours => v_end))::timestamp at time zone 'Europe/Vienna';
  select round(sum(dt) / 60.0) into v_nacht_unter from (
    select s.temperature, coalesce(r.wait_min_temp, r.eco_temp - 1.5) as grenze,
           least(extract(epoch from lead(s.timestamp) over (partition by s.room_id order by s.timestamp) - s.timestamp), 900) as dt
    from room_temperature_samples s join rooms r on r.id = s.room_id
    where s.timestamp >= n_von and s.timestamp < n_bis and r.automation_enabled is not false) x
  where dt is not null and temperature < grenze - 0.05;
  select count(distinct s.room_id) into v_nacht_raeume from room_temperature_samples s join rooms r on r.id = s.room_id
   where s.timestamp >= n_von and s.timestamp < n_bis and r.automation_enabled is not false;
  v_nacht_fenster := greatest(1, extract(epoch from n_bis - n_von) / 60.0) * greatest(1, coalesce(v_nacht_raeume, 0));

  -- NEU 02.11.2026: Netzbezug in Stunden, in denen gleichzeitig eingespeist wurde (PV verschenkt, Netz gekauft)
  select round(sum(least(imp, exp)), 2) into v_netz_einsp from (
    select date_trunc('hour', timestamp) h,
           sum(greatest(power_io, 0) * dt) / 3600000.0 as imp,
           sum(greatest(-power_io, 0) * dt) / 3600000.0 as exp
    from (select timestamp, power_io,
                 least(extract(epoch from lead(timestamp) over (order by timestamp) - timestamp), 900) as dt
          from energy_readings where timestamp >= von and timestamp < bis) e
    where dt is not null group by 1) hh;
  v_netz_einsp := coalesce(v_netz_einsp, 0);

  -- weather_data speichert Wiener Ortszeit als UTC
  select round(avg(temperature_c)::numeric, 1) into v_aussen from weather_data
   where (timestamp at time zone 'UTC') >= p_tag::timestamp and (timestamp at time zone 'UTC') < (p_tag + 1)::timestamp;
  select expected_kwh into v_prog from pv_forecasts where date = p_tag;

  -- Teilnoten
  -- Teilnoten (Stand 02.11.2026, Uli: „Eco ist das Ziel“, fester Tarif)
  -- ① Nacht: Räume halten nachts ihre Untergrenze (Raum-Minuten unter Untergrenze, Nacht dieses Tages).
  --   Noch keine Messwerte der Nacht (Bewertung vor dem Morgen) → null.
  if coalesce(v_nacht_raeume, 0) > 0 then
    n1 := round(25 * greatest(0, 1 - coalesce(v_nacht_unter, 0) / v_nacht_fenster), 1);
    if coalesce(v_nacht_unter, 0) > 120 then v_hint := v_hint || (round(v_nacht_unter / 60.0, 1)::text || ' Raum-Stunden nachts unter Untergrenze'); end if;
  else n1 := null; end if;
  if v_soc_morgen is not null and v_soc_morgen < 8 then v_hint := v_hint || 'Batterie vor dem Morgen leer (bei festem Tarif kein Fehler)'::text; end if;

  n2 := case when v_pv < 1 then 25 else round(25 * greatest(0, least(1, (v_pv - v_einsp) / v_pv)), 1) end;
  if v_einsp > 2 then v_hint := v_hint || (replace(v_einsp::text, '.', ',') || ' kWh eingespeist'); end if;

  -- ③ Komfort: Räume auf Eco, 08–22 Uhr (vorher: nur Untergrenze)
  n3 := round(25 * greatest(0, 1 - v_unter_eco / v_fenster), 1);
  if v_unter_eco > 120 then v_hint := v_hint || (round(v_unter_eco / 60.0, 1)::text || ' Raum-Stunden unter Eco'); end if;
  if v_unter > 60 then v_hint := v_hint || (round(v_unter / 60.0, 1)::text || ' Raum-Stunden unter Untergrenze'); end if;

  -- ④ Netz: Abzug nur für Netzbezug in Stunden mit gleichzeitiger Einspeisung (falscher Zeitpunkt, 2 kWh = 0 Punkte).
  --   Netzstrom an dunklen Tagen ist bei festem Tarif kein Fehler (vorher: jede kWh Heizung aus dem Netz).
  n4 := round(25 * greatest(0, 1 - v_netz_einsp / 2.0), 1);
  if v_netz_einsp > 0.3 then v_hint := v_hint || (replace(v_netz_einsp::text, '.', ',') || ' kWh Netz trotz Einspeisung'); end if;
  if coalesce(v_hz_batt, 0) > 2 then v_hint := v_hint || (replace(v_hz_batt::text, '.', ',') || ' kWh Heizung aus Batterie'); end if;
  if p_tag < date '2026-10-26' then v_hint := v_hint || 'vor Datenbeginn (Thermostate im Modus auto)'::text; end if;

  insert into tages_bewertung (tag, pv_kwh, verbrauch_kwh, einspeisung_kwh, netz_kwh, heizung_kwh, heiz_pv_kwh, heiz_batt_kwh, heiz_netz_kwh,
                               soc_sonnenuntergang, soc_morgen, nachtbedarf_pct, raum_min_unter, raum_min_unter_eco, nacht_min_unter, netz_bei_einspeisung_kwh, aussen_avg, pv_prognose_kwh,
                               n_nacht, n_sonne, n_komfort, n_netz, note, hinweis, bewertet_at)
  values (p_tag, v_pv, v_verbrauch, v_einsp, v_netz, v_hz, v_hz_pv, v_hz_batt, v_hz_netz,
          round(v_soc_sun, 1), round(v_soc_morgen, 1), round(v_need, 1), v_unter, v_unter_eco, v_nacht_unter, v_netz_einsp, v_aussen, v_prog,
          n1, n2, n3, n4, round(coalesce(n1, 0) + n2 + n3 + n4), nullif(array_to_string(v_hint, ' · '), ''), now())
  on conflict (tag) do update set
    pv_kwh = excluded.pv_kwh, verbrauch_kwh = excluded.verbrauch_kwh, einspeisung_kwh = excluded.einspeisung_kwh,
    netz_kwh = excluded.netz_kwh, heizung_kwh = excluded.heizung_kwh, heiz_pv_kwh = excluded.heiz_pv_kwh,
    heiz_batt_kwh = excluded.heiz_batt_kwh, heiz_netz_kwh = excluded.heiz_netz_kwh,
    soc_sonnenuntergang = excluded.soc_sonnenuntergang, soc_morgen = excluded.soc_morgen, nachtbedarf_pct = excluded.nachtbedarf_pct,
    raum_min_unter = excluded.raum_min_unter, raum_min_unter_eco = excluded.raum_min_unter_eco,
    nacht_min_unter = excluded.nacht_min_unter, netz_bei_einspeisung_kwh = excluded.netz_bei_einspeisung_kwh, aussen_avg = excluded.aussen_avg, pv_prognose_kwh = excluded.pv_prognose_kwh,
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

-- Vorhandene Noten nach neuem Maßstab neu rechnen
do $$
declare d date;
begin
  for d in select tag from public.tages_bewertung order by tag loop
    begin perform public.tag_bewerten(d);
    exception when others then raise notice 'tag_bewerten % übersprungen: %', d, sqlerrm; end;
  end loop;
end $$;

-- Prüfen
select battery_gate_floor_delta from public.heating_settings;
select tag, note, n_nacht, n_sonne, n_komfort, n_netz, raum_min_unter_eco, nacht_min_unter, netz_bei_einspeisung_kwh, hinweis
from public.tages_bewertung order by tag;
