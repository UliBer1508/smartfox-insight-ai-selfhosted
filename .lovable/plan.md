
# ✅ PV-Automation regelmäßig triggern + Morgen-Aufwärmphase entfernt

## Änderungen

### 1. pg_cron Job erstellt
- `pg_cron` und `pg_net` Extensions aktiviert
- Cron-Job `pv-automation-check` erstellt: ruft alle 2 Minuten die `pv-automation` Edge Function auf
- Damit werden Thermostate regelmäßig überschrieben, statt autonom nach internem TGP508-Programm zu heizen

### 2. Morgen-Aufwärmphase entfernt (`pv-automation/index.ts`)
- `isOptimalHeatingTime`-Funktion (Zeilen 80-159) entfernt
- Morgen-Aufwärmphase Block (Zeilen 1093-1136) entfernt
- Normale Tag-Logik übernimmt: Grid-Fallback → eco, PV → comfort, Boost → boost_max

### 3. Collector-Integration als Backup
- `triggerPvAutomation()` Funktion in `collector-node/index.js` hinzugefügt
- Ruft pv-automation Edge Function alle 2 Minuten via HTTPS auf
- Doppelte Absicherung: pg_cron + Collector
