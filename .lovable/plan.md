

# Consumer Logs bereinigen + Auto-Cleanup

## Problem
2.214 verwaiste Heizungs-Sessions und 46 Warmwasser-Sessions in `consumer_logs` mit `is_active = true`, die nie geschlossen wurden. Diese entstehen bei jedem Seiten-Reload, da der Hook seinen internen State verliert, aber die DB-Einträge offen bleiben. Die Verbrauchsanzeige im Dashboard zeigt dadurch falsche Werte.

## Änderungen

### 1. DB-Migration: Alle verwaisten Sessions schließen
SQL: Alle `is_active = true` Einträge auf `false` setzen, `end_time` und `duration_minutes` berechnen.

### 2. `useConsumerLogging.ts`: Cleanup beim Mount
- Beim Hook-Start alle `is_active = true` Einträge in der DB schließen (Altlasten-Bereinigung)
- Maximale Session-Dauer von 4 Stunden: Sessions die älter sind werden automatisch geschlossen

### 3. `useConsumptionAnalysis.ts`: Warmwasser-Erkennung verschärfen
- Mindestleistung auf `hotwater_power_w` (2.800W) statt 1.000W
- Unerklärter Verbrauch muss >= 70% der Boilerleistung sein
- Nur im Zeitfenster 10:00-16:00 als Warmwasser klassifizieren

### 4. Alte API-Fehler bereinigen
Die 5 verwaisten Tuya-Quota-Fehler via SQL als gelöst markieren (System läuft lokal).

