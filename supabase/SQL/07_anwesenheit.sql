-- 07_anwesenheit.sql
-- Anwesenheit (28.10.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md)
-- Kalender "Ich bin da von–bis"; außerhalb gilt das Haus als leer (abwesend):
-- jeder Tag wie ein Wartetag (Räume halten "Ohne PV", Netz nur darunter), PV lädt bis Eco,
-- kein Komfort. Nacht unverändert.
-- Im Supabase SQL-Editor des Projekts pflnniklvqbwjwrjswaz ausführen (wiederholbar).
-- Reihenfolge: dieses SQL → supabase functions deploy pv-automation → App (Vercel).

-- 1. Kalender
create table if not exists public.presence_periods (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text,
  source text not null default 'app',          -- 'app' (Kalender) / 'quick' (Schnellschalter)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presence_periods_range check (end_at > start_at)
);

create index if not exists presence_periods_end_idx on public.presence_periods (end_at);

comment on table public.presence_periods is
  'Anwesenheit: Zeiträume, in denen jemand im Haus ist. Außerhalb gilt abwesend (Konzept 28.10.2026).';

-- RLS sofort mit anlegen (Lehre: RLS ohne Policy liefert der App still leere Ergebnisse)
alter table public.presence_periods enable row level security;

drop policy if exists "Authenticated users full access" on public.presence_periods;
create policy "Authenticated users full access"
  on public.presence_periods for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 2. Einstellungen
alter table public.heating_settings
  add column if not exists presence_control_enabled boolean not null default true,
  add column if not exists presence_lead_hours numeric not null default 6;

comment on column public.heating_settings.presence_control_enabled is
  'Anwesenheit steuern: an = außerhalb der Kalender-Einträge gilt abwesend. Aus = immer anwesend (wie bis 28.10.2026).';
comment on column public.heating_settings.presence_lead_hours is
  'Vorlauf in Stunden: so lange vor einem Kalender-Eintrag gilt schon "anwesend".';

-- Kontrolle
select relname, relrowsecurity from pg_class where relname = 'presence_periods';
select policyname, cmd, roles from pg_policies where tablename = 'presence_periods';
select presence_control_enabled, presence_lead_hours from public.heating_settings limit 1;

-- Rückweg (nur falls nötig):
-- alter table public.heating_settings drop column if exists presence_control_enabled, drop column if exists presence_lead_hours;
-- drop table if exists public.presence_periods;
