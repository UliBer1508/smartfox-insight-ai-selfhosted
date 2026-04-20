
Implementiere A+B+C+D in `local-collector/collector-node/tuya-thermostat.js` und `local-collector/collector-node/index.js`.

## Änderungen

### `tuya-thermostat.js` (Refactor)
- **Persistente Verbindungen**: Verbindung wird einmal aufgebaut und gehalten, kein Disconnect nach jedem Befehl. Reconnect nur bei `disconnected`-Event oder Fehler.
- **Kein `find()`**: IP wird direkt aus Config genutzt (alle Geräte haben statische IPs). Spart 1–3s UDP-Discovery pro Aufruf.
- **`issueRefreshOnConnect: false`**: Verhindert Session-Drops durch unnötige Refresh-Roundtrips beim Connect.
- **Operation-Timeout (3s)**: Jeder `device.get()` / `device.set()` wird in `Promise.race` mit 3s Timeout gewickelt — bricht hängende Calls schnell ab statt 10s zu warten.
- **Atomic SET (multiple)**: `setTemperature` setzt `mode` + `target_temp` in **einem** `device.set({ multiple: true, data: {...} })`-Call statt zwei sequenziellen Roundtrips. Halbiert Failure-Risiko und Latenz.
- **Per-Device-Queue bleibt** (Schutz gegen parallele Zugriffe auf dasselbe Gerät).
- **Retry**: 2 Retries mit 1s/2s Backoff, bei Fehler Connection forciert geschlossen und neu aufgebaut.

### `index.js` (Sync-Orchestrierung)
- **TCP-Preflight (1s)**: Vor jedem Sync-Zyklus schneller `net.connect(6668, ip)` mit 1s Timeout pro Gerät — offline Geräte werden sofort als FAIL markiert ohne 10s Tuya-Timeout.
- **Batching (3 parallel)**: Statt `Promise.allSettled` über alle 12 → in Chunks von 3 verarbeiten. Reduziert WLAN-Congestion, verteilt CPU-Last des lokalen Service.
- **Sync-Summary-Log** bleibt (Dauer, OK/FAIL Counts).

## Erwartetes Verhalten
- Sync von 12 Thermostaten: 4 Batches × ~1–2s = **~8s statt aktuell 30–60s** mit Retries.
- Offline-Geräte (z.B. Haustür): in 1s erkannt statt 10s Timeout × 3 Retries = 30s.
- `setTemperature`: 1 Roundtrip statt 2, persistente Connection → **~300ms statt 2–3s**.
- Konfigurations-Befehle (Mode + Temp) gehen atomar durch oder schlagen sauber fehl.

## Deployment-Hinweis
Nach dem Edit musst du die zwei Dateien auf `C:\Users\ulibe\tuya-thermostat\` kopieren und den lokalen Service neu starten.

## Memory-Update
`mem://deployment/tuya-local-service-implementation` wird auf v3 aktualisiert (persistente Connections, Atomic SET, TCP-Preflight, Batching).
