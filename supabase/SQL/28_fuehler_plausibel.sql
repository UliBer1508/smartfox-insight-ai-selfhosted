-- 28_fuehler_plausibel.sql  (09.11.2026)
-- Doku: doc/FIX-FUEHLER-SONNE-UND-DP19-2026-11-09.md
--
-- Problem 1 – Sonne auf dem Fühler (Wohnzimmer, Süd):
--   An sonnigen Vormittagen springt die gemeldete Temperatur in 5–15 min um 5–9 °C (06.11.: 21,3 → 32,4 °C)
--   und fällt danach ebenso schnell zurück. Das ist Sonne auf dem Thermostat, nicht der Raum.
--   Steuerung, Planer, Raummodell, KI-Tagesanalyse und Tagesnote nahmen den Wert als Raumtemperatur.
-- Problem 2 – Temperatur-Korrektur DP 19:
--   Am 06.11. 20:04 wurde DP 19 von −1,0 auf 0 gestellt (Büro schon am 01.11. 17:52). Die gemeldete Temperatur
--   sprang danach in allen Räumen um +1,0 °C. Werte davor liegen 1 °C zu tief → alte und neue Werte nicht vergleichbar.
--   Kinder Bad: Befehl „ausgeführt“, aber DP 19 steht noch auf −10 (keine Korrektur hier, siehe Doku/TODO).
--
-- Lösung:
--   A) rooms: gemeldeter Wert in current_temp_gemeldet, current_temp = plausibler Wert. Erkennt eine Sonnenspitze
--      (Sprung ≥ 2,0 °C zur letzten Lesung oder ≥ 3,0 °C in 15 min) und hält bis zum Ende den letzten plausiblen Wert.
--      Ende: gemeldeter Wert ≥ 1,5 °C unter der Spitze und 10 min ruhig (≤ 0,3 °C je Lesung); spätestens nach 3 h.
--      Alle Grenzen einstellbar (heating_settings.fuehler_*). Nur echte Lesungen (last_thermostat_sync ändert sich).
--   B) room_temperature_samples: temperature = plausibler Wert, temperature_gemeldet = Gerätewert,
--      korrektur_dp19 = +1,0 °C für alte Werte, fuehler_sonne = Wert gehalten.
--   C) Altdaten: DP-19-Korrektur je Raum bis zum gemessenen Sprung, danach Sonnen-Prüfung rückwirkend (16 Tage).
--
-- REIHENFOLGE: dieses Skript zuerst (Teil A + B), dann PR mergen (pv-automation, App). Teil C am Ende des Skripts,
-- mit Vorschau. Wiederholbar.

-- ============================================================================================================
-- Teil A: Spalten und Einstellungen
-- ============================================================================================================
alter table public.rooms
  add column if not exists current_temp_gemeldet numeric,
  add column if not exists fuehler_sonne_seit timestamptz,
  add column if not exists fuehler_sonne_ref numeric,
  add column if not exists fuehler_sonne_max numeric,
  add column if not exists fuehler_sonne_ruhig_seit timestamptz;

comment on column public.rooms.current_temp_gemeldet is 'Vom Thermostat gemeldete Temperatur (Rohwert). current_temp ist der plausible Wert (SQL 28).';
comment on column public.rooms.fuehler_sonne_seit is 'Gesetzt, solange der Fühler eine Sonnenspitze meldet; current_temp hält dann fuehler_sonne_ref (SQL 28).';

alter table public.room_temperature_samples
  add column if not exists temperature_gemeldet numeric,
  add column if not exists korrektur_dp19 numeric,
  add column if not exists fuehler_sonne boolean not null default false;

comment on column public.room_temperature_samples.temperature_gemeldet is 'Gerätewert, falls temperature abweicht (Sonnenspitze gehalten oder DP-19-Korrektur). Leer = temperature ist der Gerätewert.';
comment on column public.room_temperature_samples.korrektur_dp19 is 'Nachträgliche Korrektur in °C (DP 19 war −1,0 °C bis 06.11.2026 20:04, Büro bis 01.11.2026 17:52).';

alter table public.heating_settings
  add column if not exists fuehler_pruefung_aktiv boolean not null default true,
  add column if not exists fuehler_sprung_c numeric not null default 2.0,
  add column if not exists fuehler_sprung15_c numeric not null default 3.0,
  add column if not exists fuehler_ende_abstand_c numeric not null default 1.5,
  add column if not exists fuehler_max_stunden numeric not null default 3;

-- ============================================================================================================
-- Teil A: Kernlogik (eine Funktion für Trigger und Nachprüfung)
-- ============================================================================================================
-- Ein Schritt der Prüfung. Eingang: gemeldeter Wert, vorheriger gemeldeter Wert, vorheriger plausibler Wert,
-- kleinster gemeldeter Wert der letzten 16 min, Zeit, bisheriger Zustand, Einstellungen.
-- Ausgang: {used, seit, ref, max, ruhig, ereignis ('start'|'ende'|null)}
create or replace function public.fuehler_schritt(
  p_raw numeric, p_prev_raw numeric, p_prev_used numeric, p_min15 numeric, p_ts timestamptz,
  p_seit timestamptz, p_ref numeric, p_max numeric, p_ruhig timestamptz,
  p_sprung numeric, p_sprung15 numeric, p_abstand numeric, p_max_h numeric)
returns jsonb language plpgsql immutable as $$
declare
  v_max numeric; v_ruhig timestamptz; v_ref numeric;
begin
  if p_seit is null then
    if p_prev_raw is not null and (p_raw - p_prev_raw >= p_sprung or p_raw - coalesce(p_min15, p_raw) >= p_sprung15) then
      v_ref := least(coalesce(p_prev_used, p_prev_raw), coalesce(p_min15, p_prev_raw));
      return jsonb_build_object('used', v_ref, 'seit', p_ts, 'ref', v_ref, 'max', p_raw, 'ruhig', null, 'ereignis', 'start');
    end if;
    return jsonb_build_object('used', p_raw, 'seit', null, 'ref', null, 'max', null, 'ruhig', null, 'ereignis', null);
  end if;

  v_max := greatest(coalesce(p_max, p_raw), p_raw);
  if p_raw <= v_max - p_abstand and abs(p_raw - coalesce(p_prev_raw, p_raw)) <= 0.3 then
    v_ruhig := coalesce(p_ruhig, p_ts);
  else
    v_ruhig := null;
  end if;

  if (v_ruhig is not null and p_ts - v_ruhig >= interval '10 minutes')
     or p_ts - p_seit > make_interval(secs => p_max_h * 3600) then
    return jsonb_build_object('used', p_raw, 'seit', null, 'ref', null, 'max', v_max, 'ruhig', null, 'ereignis', 'ende',
                              'dauer_min', round(extract(epoch from p_ts - p_seit) / 60),
                              'zeitgrenze', p_ts - p_seit > make_interval(secs => p_max_h * 3600));
  end if;
  return jsonb_build_object('used', p_ref, 'seit', p_seit, 'ref', p_ref, 'max', v_max, 'ruhig', v_ruhig, 'ereignis', null);
end $$;

-- ============================================================================================================
-- Teil A: Trigger auf rooms (vor dem Speichern)
-- ============================================================================================================
create or replace function public.trg_fuehler_plausibel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hs record; v_raw numeric; v_prev_raw numeric; v_min15 numeric; v_ts timestamptz; s jsonb;
begin
  if new.current_temp is null then return new; end if;
  -- Nur echte Lesungen (Thermostat-Dienst / tuya-control setzen dabei last_thermostat_sync).
  if old.last_thermostat_sync is not distinct from new.last_thermostat_sync then return new; end if;

  v_raw := new.current_temp;
  new.current_temp_gemeldet := v_raw;

  select fuehler_pruefung_aktiv, fuehler_sprung_c, fuehler_sprung15_c, fuehler_ende_abstand_c, fuehler_max_stunden
    into hs from heating_settings limit 1;
  if hs is null or hs.fuehler_pruefung_aktiv is not true then
    new.fuehler_sonne_seit := null; new.fuehler_sonne_ref := null; new.fuehler_sonne_max := null; new.fuehler_sonne_ruhig_seit := null;
    return new;
  end if;

  v_ts := coalesce(new.last_thermostat_sync, now());
  v_prev_raw := coalesce(old.current_temp_gemeldet, old.current_temp);
  -- Nach einer Lücke (Gerät war > 15 min nicht lesbar) ist ein Sprung keine Sonnenspitze → kein Start.
  if old.fuehler_sonne_seit is null and (old.last_thermostat_sync is null or old.last_thermostat_sync < v_ts - interval '15 minutes') then
    v_prev_raw := null;
  end if;
  select min(coalesce(temperature_gemeldet + coalesce(korrektur_dp19, 0), temperature)) into v_min15
    from room_temperature_samples where room_id = new.id and "timestamp" > v_ts - interval '16 minutes';
  if v_prev_raw is null then v_min15 := null; else v_min15 := least(v_min15, v_prev_raw); end if;

  s := fuehler_schritt(v_raw, v_prev_raw, old.current_temp, v_min15, v_ts,
         old.fuehler_sonne_seit, old.fuehler_sonne_ref, old.fuehler_sonne_max, old.fuehler_sonne_ruhig_seit,
         hs.fuehler_sprung_c, hs.fuehler_sprung15_c, hs.fuehler_ende_abstand_c, hs.fuehler_max_stunden);

  new.current_temp := (s->>'used')::numeric;
  new.fuehler_sonne_seit := (s->>'seit')::timestamptz;
  new.fuehler_sonne_ref := (s->>'ref')::numeric;
  new.fuehler_sonne_max := (s->>'max')::numeric;
  new.fuehler_sonne_ruhig_seit := (s->>'ruhig')::timestamptz;
  if new.fuehler_sonne_seit is null then new.fuehler_sonne_max := null; end if;

  if s->>'ereignis' = 'start' then
    perform protokoll_add('thermostat', new.id,
      'Fühler in der Sonne: gemeldet ' || fmt_t(v_raw) || ', gerechnet ' || fmt_t(new.current_temp),
      'Sprung ' || fmt_t(v_raw - v_prev_raw) || ' seit der letzten Lesung – Wert wird gehalten, Automatik lässt den Raum aus',
      jsonb_build_object('gemeldet', v_raw, 'vorher', v_prev_raw, 'gerechnet', new.current_temp), v_ts);
  elsif s->>'ereignis' = 'ende' then
    perform protokoll_add('thermostat', new.id,
      'Fühler wieder plausibel: ' || fmt_t(v_raw) || ' übernommen',
      'Spitze ' || fmt_t((s->>'max')::numeric) || ', ' || (s->>'dauer_min') || ' min gehalten'
        || case when (s->>'zeitgrenze')::boolean then ' – Zeitgrenze erreicht' else '' end,
      jsonb_build_object('gemeldet', v_raw, 'spitze', (s->>'max')::numeric, 'dauer_min', (s->>'dauer_min')::int), v_ts);
  end if;
  return new;
exception when others then
  raise warning 'trg_fuehler_plausibel: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_fuehler_plausibel on public.rooms;
-- Name beginnt mit „a“: BEFORE-Trigger laufen alphabetisch, dieser soll vor allen anderen laufen.
drop trigger if exists a_trg_fuehler_plausibel on public.rooms;
create trigger a_trg_fuehler_plausibel
  before update of current_temp on public.rooms
  for each row execute function public.trg_fuehler_plausibel();

-- ============================================================================================================
-- Teil B: Messwerte mit Gerätewert speichern (ersetzt capture_room_temperature_sample)
-- ============================================================================================================
create or replace function public.capture_room_temperature_sample()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pv_power integer;
begin
  if new.current_temp is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.current_temp is not distinct from new.current_temp
     and old.is_heating is not distinct from new.is_heating
     and old.last_thermostat_sync is not distinct from new.last_thermostat_sync then
    return new;
  end if;

  select round(pv_power)::int into v_pv_power
    from public.energy_readings where timestamp > now() - interval '10 minutes'
    order by timestamp desc limit 1;

  insert into public.room_temperature_samples (room_id, temperature, is_heating, pv_power_w, timestamp,
                                               temperature_gemeldet, fuehler_sonne)
  values (new.id, new.current_temp, coalesce(new.is_heating, false), v_pv_power, coalesce(new.last_thermostat_sync, now()),
          case when new.current_temp_gemeldet is distinct from new.current_temp then new.current_temp_gemeldet end,
          new.fuehler_sonne_seit is not null);
  return new;
end $$;

-- ============================================================================================================
-- Teil C: Altdaten
-- ============================================================================================================
-- C1) DP-19-Korrektur: je Raum bis zum gemessenen Sprung (+1,0 °C). Zeitpunkte aus den Messwerten
--     (erste Lesung nach dem Befehl mit Sprung ≥ 0,6 °C, geprüft 09.11.2026). Kinder Bad fehlt bewusst (DP 19 noch −10).
create table if not exists public.fuehler_korrektur (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  bis timestamptz not null,
  delta numeric not null,
  grund text not null,
  angewendet_at timestamptz
);
alter table public.fuehler_korrektur enable row level security;
drop policy if exists "Authenticated users full access" on public.fuehler_korrektur;
create policy "Authenticated users full access" on public.fuehler_korrektur for all to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);

insert into public.fuehler_korrektur (room_id, bis, delta, grund) values
  ('3d1e138f-dcc3-40a0-9aa4-17e834039419', '2026-11-06 19:13:12.164+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Bad Uli
  ('0492135f-b081-4f0a-b037-4683e38c6dc2', '2026-11-06 19:13:09.946+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Zimmer Uli
  ('e276a8e7-5d1c-4185-94ff-9f1bc229595e', '2026-11-06 19:13:12.273+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Zimmer Luis
  ('02e1f9cc-ea15-4c7b-b1cf-9299159f838c', '2026-11-06 19:09:31.711+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Zimmer Luca
  ('5c458385-167e-4314-8098-7af78e2ba81e', '2026-11-01 16:57:56.617+00', 1.0, 'DP 19 −1,0 → 0 am 01.11.2026 17:52 (Test Büro)'),
  ('83eea0c6-2646-44d1-8846-f785fd1292f9', '2026-11-06 19:13:12.170+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Wohnzimmer
  ('761d0fbf-db05-43b7-9b81-798925738854', '2026-11-06 19:09:31.705+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Flur
  ('9419cfa1-1510-4855-9f35-37e4e37f554d', '2026-11-06 19:13:10.510+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Wirtschaftsraum
  ('b94f15d6-9a87-44b6-8cc1-878e628cfd18', '2026-11-06 19:09:25.509+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Haustür
  ('333da323-5b4d-4032-ba54-1dc8e63f135c', '2026-11-06 19:09:25.524+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04'),  -- Toilette Eingang
  ('c2bbf1be-02b3-4a48-90d7-4d6cb5304cc8', '2026-11-06 19:13:08.998+00', 1.0, 'DP 19 −1,0 → 0 am 06.11.2026 20:04')   -- Waschraum
on conflict (room_id) do nothing;

-- Vorschau (nur lesen): wie viele Messwerte je Raum korrigiert würden
-- select r.name, k.bis, count(s.*) from fuehler_korrektur k join rooms r on r.id = k.room_id
--   left join room_temperature_samples s on s.room_id = k.room_id and s."timestamp" < k.bis and s.korrektur_dp19 is null
--   group by 1, 2 order by 1;

-- Anwenden (einmalig je Raum, wiederholbar: bereits korrigierte Werte werden übersprungen)
update public.room_temperature_samples s
   set temperature_gemeldet = coalesce(s.temperature_gemeldet, s.temperature),
       temperature = coalesce(s.temperature_gemeldet, s.temperature) + k.delta,
       korrektur_dp19 = k.delta
  from public.fuehler_korrektur k
 where s.room_id = k.room_id and s."timestamp" < k.bis and s.korrektur_dp19 is null;
update public.fuehler_korrektur set angewendet_at = now() where angewendet_at is null;

-- Rückweg C1 (falls nötig):
-- update room_temperature_samples set temperature = temperature_gemeldet, temperature_gemeldet = null, korrektur_dp19 = null
--  where korrektur_dp19 is not null and not fuehler_sonne;

-- C2) Sonnen-Prüfung rückwirkend (gleiche Logik wie der Trigger), je Raum ab p_ab.
create or replace function public.fuehler_nachpruefen(p_room uuid, p_ab timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hs record; x record; s jsonb;
  v_prev_raw numeric; v_prev_used numeric; v_seit timestamptz; v_ref numeric; v_max numeric; v_ruhig timestamptz;
  v_raw numeric; v_prev_ts timestamptz; v_starts int := 0; v_gehalten int := 0;
begin
  select * into hs from heating_settings limit 1;
  for x in
    select id, "timestamp" ts,
           coalesce(temperature_gemeldet, temperature) + coalesce(korrektur_dp19, 0) as raw,
           min(coalesce(temperature_gemeldet, temperature) + coalesce(korrektur_dp19, 0))
             over (order by "timestamp" range between interval '16 minutes' preceding and current row) as min15
      from room_temperature_samples where room_id = p_room and "timestamp" >= p_ab order by "timestamp"
  loop
    v_raw := x.raw;
    if v_seit is null and (v_prev_ts is null or v_prev_ts < x.ts - interval '15 minutes') then
      v_prev_raw := null; v_prev_used := null;     -- Lücke: kein Start (wie im Trigger)
    end if;
    s := fuehler_schritt(v_raw, v_prev_raw, v_prev_used, case when v_prev_raw is null then null else least(x.min15, v_prev_raw) end,
           x.ts, v_seit, v_ref, v_max, v_ruhig,
           hs.fuehler_sprung_c, hs.fuehler_sprung15_c, hs.fuehler_ende_abstand_c, hs.fuehler_max_stunden);
    if s->>'ereignis' = 'start' then v_starts := v_starts + 1; end if;
    if (s->>'seit') is not null then
      v_gehalten := v_gehalten + 1;
      update room_temperature_samples
         set temperature_gemeldet = coalesce(temperature_gemeldet, temperature),
             temperature = (s->>'used')::numeric, fuehler_sonne = true
       where id = x.id;
    else
      update room_temperature_samples
         set temperature = v_raw, fuehler_sonne = false,
             temperature_gemeldet = case when korrektur_dp19 is null then null else temperature_gemeldet end
       where id = x.id and fuehler_sonne;
    end if;
    v_prev_raw := v_raw; v_prev_used := (s->>'used')::numeric; v_prev_ts := x.ts;
    v_seit := (s->>'seit')::timestamptz; v_ref := (s->>'ref')::numeric; v_max := (s->>'max')::numeric;
    v_ruhig := (s->>'ruhig')::timestamptz;
    if v_seit is null then v_max := null; end if;
  end loop;
  return jsonb_build_object('raum', (select name from rooms where id = p_room), 'spitzen', v_starts, 'gehaltene_werte', v_gehalten);
end $$;

-- Anwenden (alle Räume, letzte 16 Tage). Ergebnis je Raum: Anzahl Spitzen und gehaltene Werte.
-- Erwartet (geprüft 09.11.2026): nur Wohnzimmer, 3 Spitzen (26.10., 31.10., 06.11.), rund 58 Werte.
select public.fuehler_nachpruefen(id, now() - interval '16 days') from public.rooms order by priority;

-- Prüfen:
-- select r.name, to_char(s."timestamp" at time zone 'Europe/Vienna','DD.MM HH24:MI') zeit, s.temperature_gemeldet, s.temperature
--   from room_temperature_samples s join rooms r on r.id = s.room_id where s.fuehler_sonne order by s."timestamp";
