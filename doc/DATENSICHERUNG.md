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
je PC (PC München = sichert jede Nacht, PC Österreich = Ersatz) letzter Lauf
mit Status bzw. „Übersprungen“, letzte gelungene Sicherung, Größe, Uhrzeit, Ordner;
Verlauf 14 Tage mit Rechner; rote Warnung, wenn die letzte gelungene Sicherung
älter als die Warnschwelle ist; gelbe Warnung, wenn PC München ausfällt (Ersatz
eingesprungen) oder der Ersatz sich nicht mehr meldet (`system_settings.backup_standby`).
Stand 13.11.2026, gleiche Regeln wie Heizung München (`frontend/src/Datensicherung.jsx`).
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

## Uhrzeit ändern (24.11.2026)

Uli: „Ich will eine Einstellung in den Karten, um die Zeiten zu ändern. Ich ändere die Zeit und drücke einen Button,
der die Änderung ausführt.“ – in **Heizung Venediger und Heizung München**, Einstellungen › Datensicherung, Karte je PC.

| Schritt | Wer | Was |
|---|---|---|
| 1 | App | Uhrzeit eintragen › **Uhrzeit ändern** → Zeile in `service_commands` (`action = 'backup_time'`, `param = 'HH:MM'`, `service_name = 'backup'`) |
| 2 | Datenbank (SQL 55) | prüft: nur Admins, PC bekannt, Uhrzeit gültig, kein zweiter Befehl offen |
| 3 | Dienste-Wächter des PCs (ab **v1.1**, alle 30 s) | stellt die geplante Aufgabe **„Supabase-Sicherung Heizung“** auf *täglich HH:MM Ortszeit* (`Set-ScheduledTask`) |
| 4 | Wächter → App | Ergebnis unter dem Button: „✓ täglich 03:45 – nächster Lauf 25.11. 03:45“ oder der Fehler |

- Die Karte findet den Wächter über den Rechnernamen (`system_hosts.info.computer` beginnt mit dem Namen aus `backup_runs`).
- Der neue Auslöser gilt in **Ortszeit** – damit ist auch das Problem „läuft seit der Zeitumstellung 1 h früher“ (Aufgabe hing an UTC) weg.
- Die Zeile „Uhrzeit“ in der Karte zeigt weiter, was das Sicherungsskript beim letzten Lauf gemeldet hat; sie springt nach der nächsten Sicherung um.
- **PC Österreich soll nach PC München laufen** (heute 03:45 und 04:15), sonst sichert der schwächere PC zuerst und München überspringt nicht – beide würden sichern.
- Fehlermeldungen: „Aufgabe … nicht gefunden“ (anderer Name → `config.json` des Wächters: `"backup_task"`),
  „mit Kennwort gespeichert“ (Uhrzeit einmal von Hand in der Aufgabenplanung ändern), „kein Zugriff“ (Wächter-Dienst ohne Adminrechte).
- Taste grau mit Hinweis: Wächter älter als v1.1, PC meldet sich nicht, oder nicht als Admin angemeldet.

**Einrichten (einmal):** SQL `55_sicherung_uhrzeit.sql` (Venediger-Repo) ausführen, dann den Wächter auf beiden PCs aktualisieren:

```powershell
# PC Österreich
cd C:\Heizung\repo; git pull; nssm restart DiensteWaechter
# PC München (Wächter liegt als Kopie in C:\Users\ulibe\dienste-waechter)
Invoke-WebRequest https://raw.githubusercontent.com/UliBer1508/smartfox-insight-ai-selfhosted/main/local-collector/dienste-waechter/index.js -OutFile C:\Users\ulibe\dienste-waechter\index.js
C:\nssm\nssm.exe restart DiensteWaechter
```
Danach zeigt der Systemstatus bei beiden PCs Wächter **1.1**.
