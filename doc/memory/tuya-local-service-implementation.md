---
name: Tuya Local Thermostat Service (historisch v2.0)
description: Eigenständiger Node.js Service (`tuya-thermostat-v2/`) für lokale TGP508-Steuerung über LAN Port 6668, parallel zum collector-node
type: feature
---

> **Stand 01.11.2026 – nicht im Einsatz.** Der hier beschriebene eigenständige Dienst `tuya-thermostat-v2/` mit `.env`
> wurde nicht eingeführt. Tatsächlich läuft der Collector `index.js` (v3.1) mit Treiber `tuya-thermostat.js` (v1.4)
> als NSSM-Dienst **SmartfoxTuya** in `C:\Users\ulibe\tuya-thermostat` mit `config.json`
> (Quelle: `local-collector/collector-node/`, siehe `SYSTEM_DOCUMENTATION.md` §10). Text unten nur als Historie.


Standalone-Prozess auf dem Windows-PC, läuft **parallel** zum bestehenden `local-collector/collector-node/` (das unverändert bleibt).

**Dateien (lokal beim User, nicht im Repo):**
- `index.js` — Hauptloop: sync-Intervall (default 60s) + command-poll (default 5s)
- `tuya-thermostat.js` — TuyAPI-Wrapper, alphanumerisch+numerisches DPS-Mapping
- `auto-discovery.js` — scannt 12 bekannte IPs parallel, schreibt `thermostat_local_ip` in `rooms`
- `generate-config.js` — baut `config.json` aus `rooms`-Tabelle
- `.env` — Secrets (SUPABASE_URL, SUPABASE_ANON_KEY); gitignored
- `snapshot.json` — Geräteversionen (v3.3 / v3.5) für Auto-Erkennung

**v2.0 Verbesserungen ggü. dem Tuya-Teil im collector-node:**
- Secrets aus `.env` statt `config.json`
- Automatische Protokoll-Versionserkennung v3.3/v3.5 via `snapshot.json`
- Exponentielles Backoff bei Verbindungsfehlern
- DB-Retry 3× mit Backoff bei Supabase-Fehlern
- Health-Check schreibt nach `service_health` (service_name='tuya-thermostat')
- Graceful Shutdown mit 3s Force-Exit-Timeout
- Logging mit ISO-Timestamps und Level-Padding

**DB-Integration:**
- liest `thermostat_commands` WHERE status='pending', schreibt status='executing'→'executed'/'failed'
- aktualisiert `rooms.current_temp/target_temp/is_heating/last_thermostat_sync` per Sync
- loggt Fehler in `api_errors` (source='tuya-local'), markiert sie bei Erfolg als resolved
- upsert auf `service_health` (service_name='tuya-thermostat') nach jedem Sync

**Konflikt-Hinweis:** Solange der alte `collector-node` ebenfalls Tuya steuert, dürfen NICHT beide Prozesse gleichzeitig auf dieselben Räume zugreifen → Race-Condition auf `thermostat_commands`. User muss vor Start des v2-Service den Tuya-Teil im collector-node stoppen.
