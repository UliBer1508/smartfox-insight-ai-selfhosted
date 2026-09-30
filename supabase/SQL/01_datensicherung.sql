-- =============================================================================
-- 01_datensicherung.sql  (Heizung, Projekt pflnniklvqbwjwrjswaz)
-- Protokoll der naechtlichen Datenbank-Sicherung + Einstellungen dafuer
-- =============================================================================
--
-- WARUM (30.09.2026):
-- Die Supabase-Organisation laeuft im Free-Plan: Supabase selbst macht KEINE
-- Backups. Seit 30.09.2026 sichert der PN40 (Muenchen) jede Nacht die komplette
-- Heizungs-Datenbank ins OneDrive (Backups\Supabase-Heizung), mit demselben
-- Skript wie die Hausverwaltung (Backup-Supabase.ps1, Profil "Heizung").
-- Doku: doc/DATENSICHERUNG.md
--
-- Damit das in der Hausverwaltung sichtbar ist und dort gesteuert werden kann:
--   1. Tabelle backup_runs — jeder Lauf schreibt am Ende EINE Zeile
--      (auch bei Fehler oder wenn pausiert). Anzeige: Einstellungen ->
--      Bereich "Datensicherung" (src/components/settings/BackupSettingsSection.tsx).
--   2. system_settings.backup_settings — das Skript liest diese Einstellungen
--      zu Beginn jedes Laufs (Pause, Aufbewahrung, Dateien ja/nein).
--
-- Wer schreibt: NUR das Sicherungsskript, ueber die direkte Datenbankverbindung
-- (Benutzer postgres, umgeht RLS). Die App liest nur.
--
-- Idempotent: mehrfaches Ausfuehren ist unschaedlich.
-- =============================================================================

create table if not exists public.backup_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null,
  finished_at     timestamptz not null default now(),
  status          text not null check (status in ('erfolgreich', 'warnungen', 'fehlgeschlagen', 'pausiert')),
  host            text,              -- Rechnername, z. B. PN40
  backup_folder   text,              -- Ordnername im OneDrive, z. B. 2026-09-30_0849
  db_bytes        bigint,            -- Groesse datenbank.dump
  table_count     integer,           -- Tabellen mit Daten im Dump
  storage_files   integer,           -- gesicherte Dateien (alle Buckets)
  storage_bytes   bigint,
  storage_skipped boolean not null default false,
  deleted_old     integer not null default 0,   -- beim Lauf geloeschte alte Sicherungen
  retention_days  integer,           -- beim Lauf verwendete Aufbewahrung
  schedule_time   text,              -- Uhrzeit der geplanten Aufgabe auf dem PC, z. B. 03:15
  messages        text[] not null default '{}', -- Warnungen / Fehlermeldung
  script_version  text
);

create index if not exists backup_runs_finished_at
  on public.backup_runs (finished_at desc);

comment on table public.backup_runs is
  'Ein Eintrag pro Lauf der naechtlichen Sicherung (Backup-Supabase.ps1 auf dem PN40). Anzeige: Einstellungen -> Datensicherung.';


-- -----------------------------------------------------------------------------
-- RLS: angemeldete Benutzer duerfen lesen (wie system_settings in diesem
-- Projekt). Der Collector (anon) sieht nichts. Schreiben nur das Skript.
-- -----------------------------------------------------------------------------
alter table public.backup_runs enable row level security;

drop policy if exists backup_runs_authenticated_select on public.backup_runs;
create policy backup_runs_authenticated_select on public.backup_runs
  for select to authenticated
  using ((select auth.uid()) is not null);


-- -----------------------------------------------------------------------------
-- GRANTs (Pflicht fuer neue Tabellen ab 30.10.2026).
-- KEIN anon: Protokoll ist nicht oeffentlich.
-- authenticated darf laut GRANT mehr, RLS erlaubt aber nur Lesen.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.backup_runs to authenticated;
grant select, insert, update, delete on public.backup_runs to service_role;


-- -----------------------------------------------------------------------------
-- Einstellungen mit Startwerten (vorhandene Werte NICHT ueberschreiben)
--   enabled          Sicherung aktiv (false = Lauf wird als "pausiert" protokolliert)
--   retention_days   Sicherungen aelter als X Tage werden geloescht
--   include_storage  Dateien aus dem Supabase-Speicher mitsichern - bei der
--                    Heizung AUS: das Projekt nutzt keinen Dateispeicher
--   warn_after_hours Karte zeigt Warnung, wenn die letzte erfolgreiche
--                    Sicherung aelter ist
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values (
  'backup_settings',
  '{"enabled": true, "retention_days": 30, "include_storage": false, "warn_after_hours": 30}'::jsonb
)
on conflict (key) do nothing;


-- -----------------------------------------------------------------------------
-- Pruefung nach dem Ausfuehren
-- -----------------------------------------------------------------------------
-- select value from public.system_settings where key = 'backup_settings';
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'backup_runs' order by grantee, privilege_type;
