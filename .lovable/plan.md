# KI/ML-Verbesserungen — strikt nur im Lokalmodus

## Garantie: Cloud-Modus bleibt unverändert

Alle Änderungen werden **konditional auf `mode === 'local'`** gegated. Sobald du in Settings auf Cloud zurückstellst, läuft alles wieder mit den heutigen Cloud-Frequenzen und -Logik. Kein Code-Pfad wird ohne diesen Check aktiviert.

## Modus-Erkennung

Quelle: `system_settings.tuya_control_mode` (`'cloud' | 'local'`) — bereits vorhanden, wird vom `useControlMode` Hook und von Edge-Functions gelesen.

- **Im Collector** (`local-collector/collector-node/index.js`): Beim Start UND zyklisch alle 5 min `tuya_control_mode` aus DB lesen → `currentMode` Variable. Nur wenn `currentMode === 'local'` werden die neuen Pfade ausgeführt.
- **In Edge-Functions** (`update-learned-policies` Cron): Beim Trigger zuerst Mode prüfen → bei Cloud Default-Verhalten beibehalten.

## Phase A — Datenverdichtung (nur Lokalmodus)

### A1. Hochfrequente Temperatur-Samples
`local-collector/collector-node/index.js` → `syncThermostats()`:
```text
nach erfolgreichem Tuya-Read pro Raum:
  if (currentMode === 'local') {
    insert room_temperature_samples {
      room_id, temperature, is_heating, pv_power_w, timestamp
    }
  }
```
Cloud-Modus: kein Sample-Insert (so wie heute).

### A2. Echte Heating-Events bei Statuswechsel
Pro Raum `lastIsHeating` im Collector-Memory cachen.
```text
if (currentMode === 'local' && newIsHeating !== lastIsHeating) {
  insert room_heating_logs {
    event_type: newIsHeating ? 'heating_start' : 'heating_stop',
    current_temp, target_temp, timestamp,
    duration_minutes (bei stop berechnen aus letztem start)
  }
}
```
Cloud-Modus: bestehende Schätz-Logik bleibt aktiv.

### A3. Sync-Intervall-Default
`config.example.json`: neue Option `sync_interval_seconds_local: 45` zusätzlich zum bestehenden `sync_interval_seconds: 60`. Collector wählt je nach `currentMode`. Cloud-Default unverändert.

## Phase B — ML-Pipeline an Lokal-Datenrate anpassen

### B1. `update-learned-policies` Cron-Frequenz
Aktuell: 1×/Tag. Plan: zusätzlich pg_cron-Job alle 6h, **der intern Mode prüft** und nur läuft wenn `local`:
```text
if (mode !== 'local') { return { skipped: 'cloud mode' } }
```
Der bestehende 03:00-Job bleibt erhalten und läuft in beiden Modi (Backup).

### B2. `ml-feature-extraction` Confidence-Berechnung
Aktuelle Confidence-Formel basiert auf `sample_count`. Bei Lokalmodus sind 10× mehr Samples normal → Schwellen entsprechend skalieren, **aber nur wenn die Datenpunkte aus den letzten 24h tatsächlich > N**. Selbstkalibrierend, kein expliziter Mode-Check nötig — funktioniert in beiden Modi korrekt.

### B3. Neue Features (Migration, additiv)
Neue nullable Spalten in `room_ml_features`:
- `thermal_inertia_seconds numeric`
- `weather_correlation_score numeric`

Werden nur befüllt wenn genug dichte Samples vorhanden — im Cloud-Modus bleiben sie NULL, nichts bricht.

## Phase C — Optional, später

Cross-Room-Wärmetransfer-Analyse als separate Edge-Function. Erst nach 1–2 Wochen Lokal-Daten evaluieren.

## Was NICHT geändert wird

- Kern-Budget-Logik (Phase 1 Eco → Phase 2 Komfort, Sticky Eco, Komfort-Sättigung)
- AI-Whitelist & 20:00–09:00 Suppression
- Cloud-Modus-Verhalten in **jeder** Hinsicht
- Bestehende pg_cron Jobs (nur additiv ergänzt)

## Rollback

Modus zurück auf Cloud → alle neuen Inserts/Jobs no-op. Migration B3 lässt nullable Spalten ungefüllt. Kein DB-Cleanup nötig.

## Empfehlung

Mit **Phase A1 + A2** starten (Collector-Änderungen, ein PR). Nach 3–7 Tagen Daten in `room_temperature_samples` und `room_heating_logs` prüfen — dann Phase B angehen.

Soll ich Phase A umsetzen?