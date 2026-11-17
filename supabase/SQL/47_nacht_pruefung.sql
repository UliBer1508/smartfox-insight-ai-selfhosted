-- 47_nacht_pruefung.sql (17.11.2026) – doc/FIX-NACHT-NUR-MIN-2026-11-17.md
-- Grundsatz (Uli, 17.11.2026): Nachts nur Min halten, nie den Estrich laden. Estrich laden nur mit PV-Überschuss bis PV-Max.
-- Die KI prüft das selbst – stündlich, über die ganze Nacht – und kontrolliert, ob Änderungen wirken.
--
-- 1) nacht_raum_kennzahlen   je Raum und Nacht (Abend des Tages `tag` bis Nachtende am Folgetag):
--      heiz_min, heiz_kwh            wie lange / wie viel geheizt (Heizminuten × gemessene Raumleistung)
--      zyklen                        Heizzyklen (heizt → aus)
--      aus_befehl_bei                Ist-Temperatur, als der Abschaltbefehl erstellt wurde (Mittel)
--      spitze_ueber_min              höchste Temperatur nach dem Abschalten minus Min (Mittel)
--      ueberlauf                     höchste Temperatur nach dem Abschalten minus Temperatur beim Abschaltbefehl (Mittel)
--                                    = Verzögerung Befehl→Thermostat + Weiterheizen + Nachheizen des Estrichs
--      abkuehl_c_h                   wie schnell der Raum ohne Heizen fällt (°C je Stunde, positiv = fällt)
--      t_morgen, t_tief              Temperatur zum Nachtende, tiefste Temperatur der Nacht
-- 2) raum_ueberlauf          je Raum der gemessene Überlauf der letzten 7 Nächte (mind. 3 Abschaltungen) –
--                            pv-automation schaltet nachts um diesen Wert früher ab.
-- 3) ki_nacht_pruefen()      rechnet die laufende und die letzte Nacht neu und frischt raum_ueberlauf auf.
--                            pg_cron stündlich (reines SQL, kein HTTP). Beim Einspielen: 8 Nächte nachrechnen.
-- 4) heating_settings: nacht_frueh_aus (an/aus), nacht_spitze_ueber_ziel_c (Ziel für die Spitze), nacht_frueh_aus_seit
--
-- Wiederholbar.

create table if not exists public.nacht_raum_kennzahlen (
  tag              date        not null,
  room_id          uuid        not null references public.rooms(id) on delete cascade,
  raum             text,
  min_temp         numeric,
  heiz_min         integer     not null default 0,
  heiz_kwh         numeric     not null default 0,
  zyklen           integer     not null default 0,
  aus_mit_befehl   integer     not null default 0,
  aus_befehl_bei   numeric,
  spitze_ueber_min numeric,
  ueberlauf        numeric,
  abkuehl_c_h      numeric,
  t_morgen         numeric,
  t_tief           numeric,
  aussen           numeric,
  vollstaendig     boolean     not null default false,
  berechnet_at     timestamptz not null default now(),
  primary key (tag, room_id)
);
comment on table public.nacht_raum_kennzahlen is 'Je Raum und Nacht: Heizen, Abschaltpunkt, Überlauf, Abkühlen (SQL 47, stündlich durch ki_nacht_pruefen).';

create table if not exists public.raum_ueberlauf (
  room_id      uuid primary key references public.rooms(id) on delete cascade,
  ueberlauf    numeric not null,
  abschaltungen integer not null,
  naechte      integer not null,
  berechnet_at timestamptz not null default now()
);
comment on table public.raum_ueberlauf is 'Gemessener Überlauf nach dem Abschaltbefehl je Raum (7 Nächte) – pv-automation schaltet nachts um diesen Wert früher ab (SQL 47).';

alter table public.nacht_raum_kennzahlen enable row level security;
alter table public.raum_ueberlauf enable row level security;
drop policy if exists nacht_raum_kennzahlen_lesen on public.nacht_raum_kennzahlen;
create policy nacht_raum_kennzahlen_lesen on public.nacht_raum_kennzahlen for select to anon, authenticated using (true);
drop policy if exists raum_ueberlauf_lesen on public.raum_ueberlauf;
create policy raum_ueberlauf_lesen on public.raum_ueberlauf for select to anon, authenticated using (true);

alter table public.heating_settings
  add column if not exists nacht_frueh_aus boolean not null default true,
  add column if not exists nacht_spitze_ueber_ziel_c numeric not null default 0.1,
  add column if not exists nacht_frueh_aus_seit timestamptz;
comment on column public.heating_settings.nacht_frueh_aus is 'Nachts früher abschalten: Ist + gemessener Überlauf ≥ Ziel + nacht_spitze_ueber_ziel_c → aus (SQL 47).';
comment on column public.heating_settings.nacht_spitze_ueber_ziel_c is 'Nachts soll die Spitze nach dem Abschalten höchstens Ziel (Min + Vorlauf) + diesen Wert erreichen (SQL 47).';
comment on column public.heating_settings.nacht_frueh_aus_seit is 'Seit wann früh abschalten gilt – Bezug für die Wirkungskontrolle der KI (SQL 47).';
update public.heating_settings set nacht_frueh_aus_seit = coalesce(nacht_frueh_aus_seit, now());

-- ---------------------------------------------------------------------------------------------------------
create or replace function public.ki_nacht_kennzahlen_rechnen(p_tag date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_start time; v_end time;
  t_von timestamptz; t_bis timestamptz;
  v_aussen numeric;
  v_n integer;
begin
  select coalesce(night_start_time::time, '20:00'), coalesce(night_end_time::time, '08:00') into v_start, v_end
    from heating_settings limit 1;
  v_start := coalesce(v_start, '20:00'); v_end := coalesce(v_end, '08:00');
  t_von := (p_tag + v_start)::timestamp at time zone 'Europe/Vienna';
  t_bis := ((p_tag + 1) + v_end)::timestamp at time zone 'Europe/Vienna';
  select aussen_avg into v_aussen from tages_bewertung where tag = p_tag;

  with s as (
    select x.room_id, x.timestamp ts, x.temperature t, x.is_heating h,
           lag(x.is_heating) over w ph,
           least(extract(epoch from lead(x.timestamp) over w - x.timestamp), 900) dt
    from room_temperature_samples x
    where x.timestamp >= t_von - interval '30 min' and x.timestamp < t_bis + interval '90 min'
    window w as (partition by x.room_id order by x.timestamp)
  ),
  innen as (select * from s where ts >= t_von and ts < t_bis),
  -- Abschaltungen: heizt → aus innerhalb der Nacht, mit dem letzten Abschaltbefehl (Soll unter Ist) davor
  aus as (
    select o.room_id, o.ts,
      (select max(y.temperature) from room_temperature_samples y
        where y.room_id = o.room_id and y.timestamp >= o.ts and y.timestamp < o.ts + interval '60 min') t_spitze,
      c.created_at c_at,
      (select y.temperature from room_temperature_samples y
        where y.room_id = o.room_id and y.timestamp <= c.created_at order by y.timestamp desc limit 1) t_befehl
    from innen o
    left join lateral (
      select c.created_at, c.value from thermostat_commands c
      where c.room_id = o.room_id and c.command = 'set_temp' and c.created_at <= o.ts and c.created_at > o.ts - interval '30 min'
      order by c.created_at desc limit 1) c on true
    where o.ph and not o.h
  ),
  aus2 as (select a.*, case when a.t_befehl is not null and a.c_at is not null then a.t_spitze - a.t_befehl end ueb from aus a),
  -- Abkühlen: Strecken ohne Heizen ≥ 60 min; gemessen ab 45 min nach Beginn (Nachheizen vorbei) bis Ende
  insel as (
    select room_id, ts, t, h, sum(case when h then 1 else 0 end) over (partition by room_id order by ts) grp from innen
  ),
  strecke as (
    select room_id, grp, min(ts) a, max(ts) e from insel where not h group by room_id, grp
    having max(ts) - min(ts) >= interval '60 min'
  ),
  fall as (
    select st.room_id,
      ((select y.t from innen y where y.room_id = st.room_id and y.ts >= st.a + interval '45 min' order by y.ts limit 1)
       - (select y.t from innen y where y.room_id = st.room_id and y.ts <= st.e order by y.ts desc limit 1))
      / nullif(extract(epoch from st.e - (st.a + interval '45 min')) / 3600, 0) c_h
    from strecke st where st.e > st.a + interval '75 min'
  )
  insert into nacht_raum_kennzahlen as k (tag, room_id, raum, min_temp, heiz_min, heiz_kwh, zyklen, aus_mit_befehl,
      aus_befehl_bei, spitze_ueber_min, ueberlauf, abkuehl_c_h, t_morgen, t_tief, aussen, vollstaendig, berechnet_at)
  select p_tag, r.id, r.name, r.wait_min_temp,
    coalesce((select round(sum(dt) filter (where h) / 60.0) from innen i where i.room_id = r.id), 0)::int,
    round(coalesce((select sum(dt) filter (where h) / 3600.0 from innen i where i.room_id = r.id), 0)
          * coalesce(r.heating_power_w, 0) / 1000.0, 2),
    (select count(*) from aus2 a where a.room_id = r.id)::int,
    (select count(a.ueb) from aus2 a where a.room_id = r.id)::int,
    (select round(avg(a.t_befehl), 2) from aus2 a where a.room_id = r.id and a.ueb is not null),
    (select round(avg(a.t_spitze - r.wait_min_temp), 2) from aus2 a where a.room_id = r.id),
    (select round(avg(a.ueb), 2) from aus2 a where a.room_id = r.id),
    (select round(avg(f.c_h), 3) from fall f where f.room_id = r.id and f.c_h is not null),
    (select round(avg(i.t), 1) from s i where i.room_id = r.id and i.ts >= t_bis - interval '15 min' and i.ts < t_bis + interval '15 min'),
    (select round(min(i.t), 1) from innen i where i.room_id = r.id),
    v_aussen,
    now() >= t_bis + interval '90 min',
    now()
  from rooms r
  where r.automation_enabled is not false
    and exists (select 1 from innen i where i.room_id = r.id)
  on conflict (tag, room_id) do update set
    raum = excluded.raum, min_temp = excluded.min_temp, heiz_min = excluded.heiz_min, heiz_kwh = excluded.heiz_kwh,
    zyklen = excluded.zyklen, aus_mit_befehl = excluded.aus_mit_befehl, aus_befehl_bei = excluded.aus_befehl_bei,
    spitze_ueber_min = excluded.spitze_ueber_min, ueberlauf = excluded.ueberlauf, abkuehl_c_h = excluded.abkuehl_c_h,
    t_morgen = excluded.t_morgen, t_tief = excluded.t_tief, aussen = excluded.aussen,
    vollstaendig = excluded.vollstaendig, berechnet_at = excluded.berechnet_at;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------
create or replace function public.ki_nacht_pruefen()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_heute date := (now() at time zone 'Europe/Vienna')::date;
  v_a int; v_b int; v_u int;
begin
  -- laufende Nacht (Abend gestern bzw. heute) und die davor
  v_a := ki_nacht_kennzahlen_rechnen(v_heute - 1);
  v_b := ki_nacht_kennzahlen_rechnen(v_heute);
  perform ki_nacht_kennzahlen_rechnen(v_heute - 2);

  -- Überlauf je Raum: gewichtetes Mittel der letzten 7 Nächte, mind. 3 Abschaltungen mit Befehl, 0 … 1,5 °C
  delete from raum_ueberlauf;
  insert into raum_ueberlauf (room_id, ueberlauf, abschaltungen, naechte, berechnet_at)
  select room_id,
         least(1.5, greatest(0, round(sum(ueberlauf * aus_mit_befehl) / nullif(sum(aus_mit_befehl), 0), 2))),
         sum(aus_mit_befehl)::int, count(*)::int, now()
  from nacht_raum_kennzahlen
  where tag >= v_heute - 8 and ueberlauf is not null and aus_mit_befehl > 0
  group by room_id
  having sum(aus_mit_befehl) >= 3;
  get diagnostics v_u = row_count;

  delete from nacht_raum_kennzahlen where tag < v_heute - 120;
  return jsonb_build_object('nacht_gestern', v_a, 'nacht_heute', v_b, 'raeume_ueberlauf', v_u, 'at', now());
end $$;

grant execute on function public.ki_nacht_pruefen() to service_role;
grant execute on function public.ki_nacht_kennzahlen_rechnen(date) to service_role;

-- Nachrechnen: 8 Nächte
do $$
declare d date;
begin
  for d in select generate_series((now() at time zone 'Europe/Vienna')::date - 8, (now() at time zone 'Europe/Vienna')::date - 1, interval '1 day')::date loop
    perform public.ki_nacht_kennzahlen_rechnen(d);
  end loop;
  perform public.ki_nacht_pruefen();
end $$;

-- Stündlich (Minute 7, nach den Messwerten), reines SQL ohne HTTP
select cron.unschedule('ki-nacht-pruefen') where exists (select 1 from cron.job where jobname = 'ki-nacht-pruefen');
select cron.schedule('ki-nacht-pruefen', '7 * * * *', 'select public.ki_nacht_pruefen()');
