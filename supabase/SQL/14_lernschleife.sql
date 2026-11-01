-- 14_lernschleife.sql  (01.11.2026)
-- Lernschleife Stufe 1 + 2 (Konzept: doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md)
--
--  Stufe 1 – saubere Daten:
--    * system_settings.learning_data_since = 2026-10-26 (vorher regelten die Thermostate nach eigenem
--      Wochenprogramm, Heizzyklen fehlten). update-learned-policies lernt nur noch ab diesem Tag.
--    * learned_policies leeren – sie stammen aus den falschen Daten; die nächste Nacht (19:30 UTC) baut sie
--      aus den sauberen Daten neu auf.
--  Stufe 2 – Tagesnote nach Ulis Zielen:
--    * Tabelle tages_bewertung: je Tag Einstellungen (abends 21:55 gemerkt) und Ergebnis (am nächsten Morgen
--      09:55 nach der Nacht-Auswertung): Note 0–100 aus vier Teilen à 25 Punkte
--        ① Nacht:   hat die Batterie bis zum Morgen gereicht?
--        ② Sonne:   Anteil der PV, der im Haus genutzt wurde (nicht eingespeist)
--        ③ Komfort: Anteil Raum-Minuten unter der Untergrenze (08–22 Uhr, alle Räume)
--        ④ Netz:    Netzstrom für die Heizung tagsüber
--    * läuft im bestehenden Cron nacht-protokoll (stündlich, Wiener Ortszeit)
--
-- Voraussetzung: SQL 10 (Nacht-Protokoll), SQL 11 (Protokoll-Modul), SQL 12 (Energie-Auswertung).
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz KOMPLETT ausführen (wiederholbar).

-- =====================================================================================
-- Stufe 1
-- =====================================================================================
insert into public.system_settings (key, value, updated_at)
values ('learning_data_since', '"2026-10-26"'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

delete from public.learned_policies;

-- =====================================================================================
-- Stufe 2: Tagesbewertung
-- =====================================================================================
create table if not exists public.tages_bewertung (
  tag                  date primary key,
  einstellungen        jsonb,          -- heating_settings (Auszug) + Räume, abends gemerkt
  pv_kwh               numeric,
  verbrauch_kwh        numeric,
  einspeisung_kwh      numeric,
  netz_kwh             numeric,
  heizung_kwh          numeric,
  heiz_pv_kwh          numeric,
  heiz_batt_kwh        numeric,
  heiz_netz_kwh        numeric,
  soc_sonnenuntergang  numeric,
  soc_morgen           numeric,        -- Ladestand am nächsten Morgen (Nacht-Protokoll)
  nachtbedarf_pct      numeric,        -- gemessener Nachtverlust (größter der Vor-Nächte)
  raum_min_unter       numeric,        -- Raum-Minuten unter Untergrenze 08–22 Uhr
  aussen_avg           numeric,
  pv_prognose_kwh      numeric,
  n_nacht              numeric,        -- Teilnoten 0–25
  n_sonne              numeric,
  n_komfort            numeric,
  n_netz               numeric,
  note                 numeric,        -- 0–100
  hinweis              text,
  bewertet_at          timestamptz,
  created_at           timestamptz not null default now()
);
comment on table public.tages_bewertung is 'Lernschleife (01.11.2026): Tagesnote nach Ulis Zielen + geltende Einstellungen. Grundlage für Vorschläge aus ähnlichen Tagen.';
alter table public.tages_bewertung enable row level security;
drop policy if exists "Authenticated read" on public.tages_bewertung;
create policy "Authenticated read" on public.tages_bewertung for select to authenticated using (auth.uid() is not null);

-- Einstellungen des Tages merken (abends, zusammen mit dem Nacht-Protokoll)
create or replace function public.tag_einstellungen_merken(p_tag date default (now() at time zone 'Europe/Vienna')::date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  select (select jsonb_object_agg(k, to_jsonb(hs) -> k) from unnest(array[
            'heating_min_battery_soc', 'heating_soc_gate_mode', 'battery_gate_floor_delta', 'battery_gate_max_power_w',
            'max_grid_heating_power_w', 'pv_surplus_threshold_on', 'night_heating_mode', 'pattern_recall_strength',
            'battery_night_reserve_pct']) as k where to_jsonb(hs) ? k)
         || jsonb_build_object('raeume', (select jsonb_agg(jsonb_build_object('raum', r.name, 'prio', r.priority, 'untergrenze', r.wait_min_temp,
                                                   'eco', r.eco_temp, 'komfort', r.comfort_temp, 'nacht', r.night_temp,
                                                   'automatik', r.automation_enabled) order by r.priority)
               from rooms r))
  into v from heating_settings hs limit 1;
  insert into tages_bewertung (tag, einstellungen) values (p_tag, v)
  on conflict (tag) do update set einstellungen = excluded.einstellungen;
end $$;

-- Tag bewerten (am Morgen danach, nach nacht_auswerten)
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

-- Takt: im bestehenden nacht-protokoll-Cron (21:55 merken, 09:55 Nacht auswerten + Vortag bewerten)
create or replace function public.nacht_protokoll_tick() returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_local timestamp := now() at time zone 'Europe/Vienna';
begin
  if extract(hour from v_local) = 21 then
    perform nacht_einstellungen_merken(v_local::date);
    perform tag_einstellungen_merken(v_local::date);
  end if;
  if extract(hour from v_local) = 9 then
    perform nacht_auswerten(v_local::date - 1);
    perform tag_bewerten(v_local::date - 1);
  end if;
end $$;

-- Nachtragen: Tage seit 26.10., soweit Energiedaten noch vorhanden (7 Tage). Einstellungen = heutige.
do $$
declare d date;
begin
  for d in select generate_series('2026-10-26'::date, (now() at time zone 'Europe/Vienna')::date - 1, '1 day')::date loop
    begin
      if not exists (select 1 from tages_bewertung where tag = d and einstellungen is not null) then
        perform tag_einstellungen_merken(d);
        perform tag_bewerten(d);
        update tages_bewertung set hinweis = concat_ws(' · ', hinweis, 'Einstellungen nachgetragen (Stand 01.11.)') where tag = d;
      else
        perform tag_bewerten(d);
      end if;
    exception when others then
      raise notice 'tag_bewerten % übersprungen: %', d, sqlerrm;
    end;
  end loop;
end $$;

-- Kontrolle
select tag, note, n_nacht, n_sonne, n_komfort, n_netz, pv_kwh, heizung_kwh, heiz_batt_kwh, soc_sonnenuntergang, soc_morgen, raum_min_unter, hinweis
from public.tages_bewertung order by tag;
