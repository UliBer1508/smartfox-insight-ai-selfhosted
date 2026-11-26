-- 61_ki_haiku.sql (26.11.2026) – Haiku-Prüfer in ki-tagesanalyse
-- Konzept: doc/KONZEPT-KI-HAIKU-2026-11-26.md
--
-- 1. Schalter system_settings.ki_haiku (Start: AUS)
-- 2. Tabelle ki_haiku_lauf – je Tag ein Lauf: Tokens, Dauer, Ergebnis, Fehler
-- 3. Funktion ki_haiku_bilanz(p_tage) – Haiku gegen feste Regeln: vorgeschlagen, genehmigt, Wirkung; Kosten
--
-- Nebenwirkungen geprüft (doc §5): ki_vorschlaege braucht keine Änderung (quelle ist freier Text, kein Check),
-- Genehmigen läuft über die Whitelist wie bisher, der Wirkungsbericht in ki-tagesanalyse wertet alle Quellen aus.

-- 1. Schalter ------------------------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('ki_haiku', jsonb_build_object('aktiv', false, 'modell', 'claude-haiku-5-5'))
on conflict (key) do nothing;

-- 2. Läufe ---------------------------------------------------------------------------------------------
create table if not exists public.ki_haiku_lauf (
  tag            date primary key,
  erstellt_at    timestamptz not null default now(),
  modell         text,
  ok             boolean not null default false,
  input_tokens   integer,
  output_tokens  integer,
  dauer_ms       integer,
  befunde        integer,
  vorschlag      boolean,
  plateau        boolean,
  antwort        jsonb,
  hinweis        text,
  fehler         text
);

alter table public.ki_haiku_lauf enable row level security;
drop policy if exists "Authenticated read" on public.ki_haiku_lauf;
create policy "Authenticated read" on public.ki_haiku_lauf for select to authenticated using (auth.uid() is not null);
-- geschrieben wird nur von ki-tagesanalyse (service_role, umgeht RLS)

-- 3. Bilanz --------------------------------------------------------------------------------------------
-- Preise Haiku 5.5 (Prompts bis 100.000 Tokens): 0,10 $ Input / 0,50 $ Output je Million Tokens (Stand 11/2026).
create or replace function public.ki_haiku_bilanz(p_tage integer default 28)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select case when quelle = 'haiku' then 'haiku' else 'regeln' end as von, *
    from ki_vorschlaege
    where art = 'vorschlag' and quelle in ('haiku', 'tagesanalyse')
      and created_at > now() - make_interval(days => p_tage)
  ),
  je as (
    select von, jsonb_build_object(
      'vorgeschlagen', count(*),
      'genehmigt',     count(*) filter (where status in ('genehmigt', 'geaendert')),
      'abgelehnt',     count(*) filter (where status = 'abgelehnt'),
      'offen',         count(*) filter (where status = 'offen'),
      'besser',        count(*) filter (where wirkung->>'urteil' = 'besser'),
      'gleich',        count(*) filter (where wirkung->>'urteil' = 'gleich'),
      'schlechter',    count(*) filter (where wirkung->>'urteil' = 'schlechter')
    ) as z
    from v group by von
  ),
  l as (
    select count(*) as laeufe,
           count(*) filter (where ok) as ok,
           count(*) filter (where plateau) as plateau,
           coalesce(sum(input_tokens), 0) as tin,
           coalesce(sum(output_tokens), 0) as tout,
           (select count(*) from ki_vorschlaege where quelle = 'haiku' and art = 'info'
              and created_at > now() - make_interval(days => p_tage)) as hinweise
    from ki_haiku_lauf where tag > current_date - p_tage
  )
  select jsonb_build_object(
    'tage', p_tage,
    'haiku',  coalesce((select z from je where von = 'haiku'),  '{}'::jsonb),
    'regeln', coalesce((select z from je where von = 'regeln'), '{}'::jsonb),
    'laeufe', l.laeufe, 'laeufe_ok', l.ok, 'plateau_meldungen', l.plateau, 'hinweise', l.hinweise,
    'kosten_usd', round((l.tin * 0.10 + l.tout * 0.50) / 1000000.0, 4),
    'aktiv', (select (value->>'aktiv')::boolean from system_settings where key = 'ki_haiku')
  )
  from l;
$$;

grant execute on function public.ki_haiku_bilanz(integer) to authenticated;
