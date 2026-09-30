# Datensicherung der Heizungs-Datenbank

> Stand: 30.09.2026 · Projekt `pflnniklvqbwjwrjswaz` · läuft auf dem PN40 (München)

## Warum

Die Supabase-Organisation läuft im **Free-Plan** — Supabase macht dort **keine**
Backups. Der PN40 sichert deshalb jede Nacht die komplette Heizungs-Datenbank
ins OneDrive, mit demselben Skript wie die Hausverwaltung
(`Backup-Supabase.ps1`, Profil **„Heizung“**).

## Was wo liegt

| Was | Wo |
|---|---|
| Sicherungen | `OneDrive\Backups\Supabase-Heizung\JJJJ-MM-TT_HHMM\datenbank.dump` |
| Status auf einen Blick | `OneDrive\Backups\Supabase-Heizung\LETZTE-SICHERUNG.txt` |
| Skripte (für alle Profile) | `C:\Users\ulibe\supabase-backup\` |
| Konfiguration + verschlüsseltes Passwort | `C:\Users\ulibe\supabase-backup\Heizung\` |
| Geplante Aufgabe | „Supabase-Sicherung Heizung“, täglich 03:45 |

Gesichert wird **nur die Datenbank** — das Projekt nutzt keinen Supabase-Dateispeicher.

## In der App

Einstellungen → Bereich **„Datensicherung“**
(`src/components/settings/BackupSettingsSection.tsx`):
letzte Sicherung mit Status, Größe, Rechner, Uhrzeit, Ordner, Verlauf, rote
Warnung, wenn die letzte gelungene Sicherung älter als die Warnschwelle ist.
Einstellbar: Sicherung aktiv/pausiert, Aufbewahrung (Tage), Warnschwelle (Stunden).

Datenquellen:
- Tabelle `backup_runs` — eine Zeile pro Lauf (Hook `useBackupRuns.ts`,
  Helfer `lib/backupStatus.ts`)
- `system_settings.backup_settings` — Einstellungen (Hook `useBackupSettings.ts`)

Beides legt `supabase/SQL/01_datensicherung.sql` an (einmal im SQL-Editor
ausführen, wiederholbar). Geschrieben wird `backup_runs` nur vom Skript über die
direkte Datenbankverbindung; die App liest nur.

## Einrichtung (einmalig, am PN40)

PowerShell **als Administrator**:
```
cd $env:USERPROFILE\supabase-backup
Set-ExecutionPolicy -Scope Process Bypass
.\Setup-SupabaseBackup.ps1 -Profil Heizung
```
Abgefragt werden: Verbindungszeile (Supabase → Heizungs-Projekt → Connect →
Direct → **Session pooler**), Datenbank-Passwort des Heizungs-Projekts
(wird sofort geprüft), Secret-Key (Enter = überspringen), Uhrzeit (Enter = 03:45).

## Wartung

| Anlass | Befehl |
|---|---|
| Datenbank-Passwort geändert | `.\Set-DbPassword.ps1 -Profil Heizung` |
| Sicherung sofort starten | Aufgabenplanung → „Supabase-Sicherung Heizung“ → Ausführen |
| Pausieren / Aufbewahrung | in der App unter Einstellungen → Datensicherung |

Ausführliche Anleitung inkl. Wiederherstellung: Hausverwaltung,
`docs/Datensicherung.md`.
