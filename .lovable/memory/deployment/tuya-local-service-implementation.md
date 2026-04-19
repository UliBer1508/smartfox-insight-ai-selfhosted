---
name: Tuya Local Service Implementation
description: Lokaler Tuya-Thermostat-Service mit Per-Device-Queue, Connect-Timeout und garantiertem Disconnect für stabile LAN-Steuerung
type: feature
---

Der lokale Thermostat-Service (`local-collector/collector-node/tuya-thermostat.js`, Hybrid v2) steuert TGP508 über LAN (Port 6668) mit folgenden Robustheits-Features:

**1. Per-Device Command-Queue (`enqueue`)**
Eine Promise-Kette pro `device_id` serialisiert alle Operationen (`getStatus`, `setTemperature`, `setMode`). Verhindert parallele Zugriffe auf dasselbe Tuya-Gerät, die TuyAPI sonst zu hängenden Promises führen würden. Queue läuft auch nach Fehler im vorherigen Job weiter (`.then(fn, fn)`).

**2. Connect-Timeout (5 Sekunden)**
`safeConnect()` umhüllt `device.connect()` mit einem Promise.race-Timeout von 5000ms. Bei toter IP/Gerät bricht der Verbindungsversuch sauber ab statt ewig zu hängen.

**3. Garantiertes Disconnect (try/finally)**
`safeDisconnect()` läuft IMMER im `finally`-Block — auch bei Fehler oder Retry. Verhindert half-open TCP-Verbindungen, die Folge-Befehle blockieren würden.

**4. Retry-Logik innerhalb der Queue**
3 Retries mit Exponential Backoff (1s, 2s, 3s) bei Verbindungsfehlern. Disconnect zwischen Retries garantiert frische Verbindung.

**5. Korrektes TGP508 DPS-Mapping (beibehalten)**
`MODE='1'` (String: auto/manual/off), `TARGET_TEMP='2'` (×10, z.B. 210 = 21.0°C), `CURRENT_TEMP='3'` (×10), `HEATING='4'` (boolean, read-only).

**6. setTemperature-Sequenz (beibehalten)**
Setzt zuerst `mode='manual'` (deaktiviert interne Zeitprogramme), dann `target_temp` × 10 (Validierung 50–350).

**7. Graceful Shutdown**
`disconnectAll()` schließt alle Verbindungen und leert Pool + Queues.

Pfad auf dem User-Rechner: `C:\Users\ulibe\tuya-thermostat`. Polling-Intervall im Aufrufer (`index.js`) bleibt unverändert (60s Status-Sync). Queue + Timeout machen häufigeres Polling unkritisch.
