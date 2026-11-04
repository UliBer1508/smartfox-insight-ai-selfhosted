-- 21_ki_zu_entscheiden.sql  (04.11.2026)
-- Konzept doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md §9 (Mockup freigegeben 04.11.2026: „passt“):
-- Alles, was die KI vorschlägt, an EINEM Platz (Tab KI › Zu entscheiden), in einfachen Worten.
--
--  1) ki_vorschlaege  – ein Vorschlag je Zeile: Frage, „Was sich ändert“, „Warum“, „Was es bringt – und kostet“,
--                       alter/neuer Wert, Status (offen/genehmigt/geaendert/abgelehnt/erledigt), Wirkung nach 3 Tagen
--  2) ki_tagespaket   – je Tag ein kurzer Rückblick („Gestern …“), täglich 10:00 von ki-tagesanalyse
--  3) ki_raum_tag()   – Tageswerte je Raum (Minuten unter Eco, wärmste Temperatur, Morgentemperatur, Heizminuten)
--  4) battery_soc_suggestions.decided_value – „Anderer Wert“ bei der Batterie-Empfehlung
--  5) Cron ai-parameter-advisor-15min abschalten (Gemini schlug stündlich Werte vor, die niemand sah;
--     die Batterie-Empfehlung 21:00 läuft über analysis-scheduler weiter)
--
-- Im Supabase SQL-Editor ausführen (wiederholbar). Danach Edge Functions ki-tagesanalyse, analysis-scheduler,
-- battery-soc-decision deployen (GitHub-Aktion oder supabase functions deploy).

-- 1) Vorschläge ------------------------------------------------------------------------------------------
create table if not exists public.ki_vorschlaege (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  tag            date not null,                     -- ausgewerteter Tag (Wiener Datum)
  quelle         text not null,                     -- tagesanalyse | batterie | rueckblick
  art            text not null,                     -- vorschlag | ruecknahme | info
  titel          text not null,                     -- als Frage: „Flur morgens etwas wärmer halten?“
  was            text,                              -- Was sich ändert
  warum          text,                              -- Warum
  wirkung_text   text,                              -- Was es bringt – und kostet
  parameter_key  text,
  scope          text,                              -- global | room
  room_id        uuid references public.rooms(id) on delete cascade,
  alt_wert       numeric,
  neu_wert       numeric,
  min_wert       numeric,
  max_wert       numeric,
  einheit        text,                              -- °C | W | %
  tage_basis     int,                               -- auf wie vielen Tagen der Vorschlag beruht
  belege         jsonb,                             -- Zahlen je Tag (zum Nachprüfen)
  bezug_id       uuid references public.ki_vorschlaege(id) on delete set null,  -- Rücknahme: worauf sie sich bezieht
  status         text not null default 'offen',     -- offen | genehmigt | geaendert | abgelehnt | erledigt
  entschieden_at timestamptz,
  entschieden_wert numeric,
  notiz          text,
  wirkung        jsonb,                             -- nach 3 Tagen: {urteil, note_vorher, note_nachher, ...}
  wirkung_at     timestamptz
);
comment on table public.ki_vorschlaege is
  'KI › Zu entscheiden (04.11.2026): ein gemeinsamer Ort für alle KI-Vorschläge in einfachen Worten. Uli genehmigt, ändert oder lehnt ab.';
create index if not exists ki_vorschlaege_status_idx on public.ki_vorschlaege (status, created_at desc);

alter table public.ki_vorschlaege enable row level security;
drop policy if exists "Authenticated read" on public.ki_vorschlaege;
create policy "Authenticated read" on public.ki_vorschlaege for select to authenticated using (auth.uid() is not null);
drop policy if exists "Authenticated decide" on public.ki_vorschlaege;
create policy "Authenticated decide" on public.ki_vorschlaege for update to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "Authenticated insert" on public.ki_vorschlaege;
create policy "Authenticated insert" on public.ki_vorschlaege for insert to authenticated with check (auth.uid() is not null);

-- 2) Tagespaket ------------------------------------------------------------------------------------------
create table if not exists public.ki_tagespaket (
  tag          date primary key,
  text         text not null,
  note         numeric,
  zahlen       jsonb,
  vorschlaege  int not null default 0,
  erstellt_at  timestamptz not null default now()
);
comment on table public.ki_tagespaket is 'KI › Zu entscheiden: Rückblick auf den Vortag in einem Satz (ki-tagesanalyse, täglich 10:00).';
alter table public.ki_tagespaket enable row level security;
drop policy if exists "Authenticated read" on public.ki_tagespaket;
create policy "Authenticated read" on public.ki_tagespaket for select to authenticated using (auth.uid() is not null);

-- 3) Tageswerte je Raum ----------------------------------------------------------------------------------
-- Tag = Wiener Kalendertag, Tagesfenster night_end_time … night_start_time (wie die Tagesnote, Standard 08–22 Uhr).
create or replace function public.ki_raum_tag(p_tag date)
returns table (room_id uuid, raum text, prioritaet int, eco numeric, komfort numeric, untergrenze numeric,
               estrich_bis numeric, min_unter_eco int, t_max numeric, t_morgen numeric, heiz_min int, messwerte int)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_end int; v_start int;
  t_von timestamptz; t_bis timestamptz; m_von timestamptz;
begin
  select coalesce(extract(hour from night_end_time::time), 8)::int, coalesce(extract(hour from night_start_time::time), 22)::int
    into v_end, v_start from heating_settings limit 1;
  v_end := coalesce(v_end, 8); v_start := coalesce(v_start, 22);
  t_von := (p_tag + make_interval(hours => v_end))::timestamp at time zone 'Europe/Vienna';
  t_bis := (p_tag + make_interval(hours => v_start))::timestamp at time zone 'Europe/Vienna';
  m_von := t_von - interval '1 hour';
  return query
  with s as (
    select x.room_id, x.timestamp, x.temperature, x.is_heating,
           least(extract(epoch from lead(x.timestamp) over (partition by x.room_id order by x.timestamp) - x.timestamp), 900) as dt
    from room_temperature_samples x
    where x.timestamp >= m_von and x.timestamp < t_bis
  )
  select r.id, r.name::text, r.priority::int, r.eco_temp::numeric, r.comfort_temp::numeric, r.wait_min_temp::numeric,
         r.pv_boost_max_temp::numeric,
         coalesce(round(sum(s.dt) filter (where s.timestamp >= t_von and s.temperature < r.eco_temp - 0.3) / 60.0), 0)::int,
         round(max(s.temperature) filter (where s.timestamp >= t_von)::numeric, 1),
         round(avg(s.temperature) filter (where s.timestamp < t_von)::numeric, 1),
         coalesce(round(sum(s.dt) filter (where s.timestamp >= t_von and s.is_heating) / 60.0), 0)::int,
         count(s.*) filter (where s.timestamp >= t_von)::int
  from rooms r
  left join s on s.room_id = r.id
  where r.automation_enabled is not false
  group by r.id, r.name, r.priority, r.eco_temp, r.comfort_temp, r.wait_min_temp, r.pv_boost_max_temp
  order by r.priority nulls last;
end $$;
grant execute on function public.ki_raum_tag(date) to authenticated, service_role;

-- 4) Batterie: eigener Wert beim Genehmigen ---------------------------------------------------------------
alter table public.battery_soc_suggestions add column if not exists decided_value numeric;

-- 5) Stündliche Gemini-Vorschläge abschalten (ersetzt durch ki-tagesanalyse 10:00) ----------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'ai-parameter-advisor-15min') then
    perform cron.unschedule('ai-parameter-advisor-15min');
  end if;
end $$;

-- Kontrolle
select 'ki_vorschlaege' as tabelle, count(*) from public.ki_vorschlaege
union all select 'ki_tagespaket', count(*) from public.ki_tagespaket;
select * from public.ki_raum_tag(((now() at time zone 'Europe/Vienna')::date - 1));
select jobname, schedule, active from cron.job where command ilike '%ai-parameter-advisor%' or jobname ilike '%analysis-scheduler%';
