# Steinbock Chalets – Heizungsmanagement (selfhosted)

PV-gesteuerte Heizung für die Steinbock Chalets: Energiedaten (Fronius/Smartfox),
Raumthermostate (Tuya), KI-Planung über Google Gemini.

| | |
|---|---|
| App | https://heizung.steinbockchalets-charge.com |
| Hosting | Vercel (Auto-Deploy aus `main`) |
| Datenbank | Supabase, Projekt `pflnniklvqbwjwrjswaz` (eu-central-2), Organisation „KI-Heizungssteuerung“ |
| Datensicherung | nächtlich durch den PN40 ins OneDrive – siehe `doc/DATENSICHERUNG.md` |
| Datensammler | `local-collector/` (läuft lokal, schreibt in Supabase) |

## Dokumentation

**Vor jeder Änderung lesen:** `doc/README.md` → `doc/SYSTEM_DOCUMENTATION.md`
(Master-Dokument), Detail-Specs in `doc/memory/`, offene Punkte in `doc/TODO.md`.

## Entwicklung

```sh
bun install          # Paketverwaltung: Bun (bun.lock)
bun run dev          # lokaler Server
bun run build        # Produktions-Build nach dist/
```

- Pakete nur mit `bun add` / `bun install` ändern. Taucht in `bun.lock` `pkg.dev`
  oder `lovable` auf, ist etwas falsch.
- SQL-Änderungen: Dateien in `supabase/SQL/`, im Supabase SQL-Editor ausführen.
  Neue Tabellen brauchen explizite GRANTs.
- Edge Functions liegen in `supabase/functions/` und werden einzeln deployt.

## Herkunft

Ursprünglich mit Lovable erstellt; seit Juli 2026 vollständig selbst gehostet
(siehe `MIGRATION-Lovable-zu-eigenem-Supabase.md`). Seit 30.09.2026 besteht keine
Verbindung mehr zu Lovable.
