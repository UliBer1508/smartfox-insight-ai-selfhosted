---
name: Tuya Local Service Implementation
description: Lokaler Tuya-Thermostat-Service v3 mit persistenten Verbindungen, Atomic SET, TCP-Preflight und Batching für stabile LAN-Steuerung von 12 TGP508
type: feature
---

Der lokale Thermostat-Service (`local-collector/collector-node/tuya-thermostat.js` + `index.js`, **Hybrid v3**) steuert 12 TGP508 über LAN (Port 6668). Pfad auf User-Rechner: `C:\Users\ulibe\tuya-thermostat\`.

**1. Persistente Verbindungen (v3 NEU)**
TuyAPI-Instanzen werden EINMAL verbunden und gehalten. `ensureConnected()` reconnectet nur, wenn `isConnected()` false ist oder ein Fehler aufgetreten ist. Spart 1–2s Connect-Overhead pro Befehl gegenüber v2 (Connect/Disconnect-pro-Call).

**2. Kein UDP find() (v3 NEU)**
`device.find()` wurde komplett entfernt. IP wird direkt aus `config.json` (statische IPs aller 12 Geräte) verwendet. Spart 1–3s UDP-Discovery pro Aufruf und vermeidet Discovery-Failures.

**3. issueRefreshOnConnect: false (v3 NEU)**
Verhindert unnötige Refresh-Roundtrips beim Connect, die bei TGP508 zu Session-Drops führten.

**4. Operation-Timeout 3s via Promise.race (v3 NEU)**
`withTimeout()` wickelt jeden `device.get()` und `device.set()` mit 3s Timeout. Bricht hängende Calls schnell ab statt 10s zu warten.

**5. Atomic SET via {multiple: true} (v3 NEU)**
`setTemperature` setzt `mode='manual'` + `target_temp` in EINEM `device.set({ multiple: true, data: {...} })`-Call. Halbiert Latenz und Failure-Risiko (1 Roundtrip statt 2).

**6. Per-Device Command-Queue (beibehalten)**
Promise-Kette pro `device_id` serialisiert `getStatus`/`setTemperature`/`setMode`. Verhindert parallele Zugriffe auf dasselbe Tuya-Gerät.

**7. Retry-Logik (2 Retries, 1s/2s Backoff)**
Bei Fehler: forceDisconnect → Backoff → Retry mit frischer Connection.

**8. TCP-Preflight in index.js (v3 NEU)**
Vor jedem Sync-Zyklus prüft `tcpProbe(ip, 6668, 1000)` alle 12 Geräte parallel in <1s. Offline-Geräte werden sofort als `device_offline` in `api_errors` geloggt OHNE 10s Tuya-Timeout durchlaufen zu müssen.

**9. Batching á 3 (v3 NEU)**
`runInBatches(devices, 3, worker)` verarbeitet Sync in Chunks von 3 parallelen Requests statt alle 12 gleichzeitig. Reduziert WLAN-Congestion und CPU-Last des lokalen Service.

**10. TGP508 DPS-Mapping (beibehalten)**
`MODE='1'` (auto/manual/off), `TARGET_TEMP='2'` (×10), `CURRENT_TEMP='3'` (×10), `HEATING='4'` (boolean read-only).

**Performance-Erwartung v3:**
- Sync 12 Thermostate: ~8s (4 Batches × 2s) statt 30–60s in v2
- setTemperature: ~300ms (1 Roundtrip, persistent) statt 2–3s in v2
- Offline-Geräte: 1s Erkennung statt 30s (Timeout × 3 Retries)

**Deployment:** Nach Code-Änderung müssen `tuya-thermostat.js` + `index.js` auf `C:\Users\ulibe\tuya-thermostat\` kopiert und der Service (`node index.js`) neu gestartet werden.
