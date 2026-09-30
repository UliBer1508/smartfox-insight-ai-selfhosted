# FIX: Datenbank über Free-Limit, Log-Ingestion bei 97 %

**Datum:** 30. September 2026
**Supabase:** `pflnniklvqbwjwrjswaz` (Free-Plan: 0,5 GB Datenbank, 1 GB Logs/Monat)

## 1. Datenbank 0,7 GB → 64 MB

| Tabelle | Größe vorher | Ursache |
|---|---|---|
| `cron.job_run_details` | 409 MB | Protokoll jedes Cron-Laufs, wurde nie gelöscht |
| `room_temperature_samples` | 126 MB | `cleanup_old_data()` war nicht eingeplant |
| `api_errors` | 51 MB | Altlast vor dem Fix vom 16.09.; ebenfalls nie bereinigt |
| `learning_events` | 23 MB | dito |

**Fix:** `supabase/SQL/02_speicher_bereinigung.sql`, danach `vacuum full` auf die vier Tabellen.
Neue tägliche Jobs:

| Job | Zeit (UTC) | Aufgabe |
|---|---|---|
| `daily-purge-cron-history` | 03:20 | Cron-Protokoll älter als 3 Tage löschen |
| `daily-cleanup-old-data` | 03:30 | `cleanup_old_data()` (Aufbewahrungszeiten siehe Funktion) |

Die Einstellung „Datenspeicherung“ in der App (`aggregate-energy-data`, 03:00 UTC) betrifft
nur `energy_readings`/`hourly_aggregates` und war nicht die Ursache (9 MB).

## 2. Log-Ingestion

Messung 24 h: 47.600 API-Aufrufe, 8.100 Postgres-, 3.100 Edge-Function-Einträge.

| Ursache | Fix |
|---|---|
| `pv-automation-check` und `evaluate-decision-batch` alle 2 Min, Energiedaten kommen nur alle 5 Min | beide auf `*/5` — `supabase/SQL/03_cron_takt_5min.sql` |
| Tuya-Dienst schrieb nach jedem Sync pro Raum direkt in `room_temperature_samples` → mit anon-Schlüssel RLS-Fehler (HTTP 401), ~4.200/Tag | Block A1 im Dienst entfernt (`local-collector/tuya-thermostat/index.js`). Das Sample legt der Trigger `trg_capture_room_temperature_sample` beim `rooms`-Update an — geprüft: 50 Samples in 15 Min nach dem Neustart. |

Der Tuya-Dienst stößt `pv-automation` weiterhin direkt nach jedem neuen Messwert an.

## 3. Offen

- Der Tuya-Dienst schreibt Schaltwechsel (Block A2) in `room_heating_logs` — scheitert ebenso
  an RLS (anon hat nur Policies für `rooms`, `service_health`). Wenige Aufrufe pro Tag, aber die
  vom Thermostat selbst ausgelösten Schaltvorgänge fehlen dem Lernsystem. Lösung bei Bedarf:
  Trigger analog zu den Temperatur-Samples.
- App-Polling: `useRooms` lädt alle 15 s und pausiert im Hintergrund nicht (mehrere Instanzen).
  Kleiner Anteil, da die App selten offen ist.
