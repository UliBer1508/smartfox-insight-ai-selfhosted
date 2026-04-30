## Was sich ändert

Drei klare Maßnahmen — keine komplexe Quota-Differenzierung mehr nötig.

### 1. Haustür aus der Automation nehmen

Sie ist über die Tuya-Cloud-Subscription nicht mehr steuerbar — wir versuchen sie gar nicht erst anzusprechen.

- **DB-Update** (insert-Tool): `UPDATE rooms SET automation_enabled=false, pv_auto_enabled=false, heating_paused_reason='Tuya Cloud-Subscription: Gerät nicht steuerbar' WHERE name='Haustür';`
- **Resolve aller offenen `60001001`-Fehler**: `UPDATE api_errors SET resolved_at=NOW() WHERE error_message ILIKE '%controllable device pool%' AND resolved_at IS NULL;`
- **UI-Hinweis** in der Settings-/Räume-Liste: kleines Badge "Cloud-Subscription erschöpft" neben Haustür, plus Tooltip "automation_enabled wurde deaktiviert um wiederholte API-Fehler zu vermeiden". Kein globaler Banner.

Damit hat der Code automatisch nichts mehr zu tun mit Haustür — Filter `automation_enabled=true` greift bereits in `pv-automation` und `apply-recommendations`.

### 2. Cloud-only erzwingen wenn `controlMode='cloud'` (`pv-automation`)

Drei Stellen schreiben aktuell direkt in `thermostat_commands` (Local-Pfad), auch wenn der User Cloud konfiguriert hat:

- **SOC-Gate-Notfall-Stops (Zeile ~1701)**: Statt `thermostat_commands.insert(...)` für jeden Kandidaten → Loop über Räume und `setTemperatureForMode(deviceId, roomId, nightTemp, 'stop')` aufrufen. Diese Funktion routet je nach Mode korrekt: Cloud-Modus → Tuya-API mit STOP-Reserve, Local-Modus → DB-Queue.
- **Mikro-Rotation Ende (Zeile ~2035)**: Gleicher Umbau — `setTemperatureForMode(...)` mit `priority='stop'`.
- **`queueLocalTemperatureCommand`** (Zeile ~413-453): bleibt — wird nur im Local-Branch von `setTemperatureForMode` aufgerufen, ist also schon korrekt.

Effekt: Bei `controlMode='cloud'` werden keine neuen `thermostat_commands` mehr eingefügt. Wenn ein einzelnes Cloud-Set scheitert (außer Quota), wird es wie heute als `api_errors` geloggt und im nächsten 2-min-Run erneut versucht.

### 3. Stale Pending Commands aufräumen

- **Migration** (Schema): neue Funktion `expire_stale_thermostat_commands()` SECURITY DEFINER, schreibt:
  ```sql
  UPDATE thermostat_commands
  SET status='expired',
      error_message='Auto-expired: kein Worker hat Command innerhalb 2h abgeholt',
      executed_at=NOW()
  WHERE status='pending' AND created_at < NOW() - INTERVAL '2 hours';
  ```
- **pg_cron** Job alle 30 min ruft die Funktion auf.
- **Sofortiges Expire** der aktuellen 54 hängenden Commands (insert-Tool) damit die DB sauber startet.

### 4. Reihenfolge & Test

1. Migration: `expire_stale_thermostat_commands()` + pg_cron
2. Daten-Update: Haustür `automation_enabled=false`, offene 60001001-Errors resolven, 54 Pending-Commands auf `expired`
3. `pv-automation` umbauen (SOC-Gate-Stops + Mikro-Rotation auf `setTemperatureForMode`)
4. UI: kleines Badge "Cloud-Subscription erschöpft" bei Haustür in der Räume-Übersicht
5. Test: `curl_edge_functions` `/pv-automation` → prüfen dass kein neuer `thermostat_commands.insert` passiert und keine neuen `60001001`-Errors auftauchen

## Was diese Änderung NICHT macht

- Keine Quota-Code-Differenzierung mehr (war ursprünglich Punkt 1) — durch Haustür-Deaktivierung obsolet.
- Keine Änderung an SOC-Gate-Logik, Heating-Strategie, Local-Service-Code.
- Local-Service bleibt deaktivierbar/inaktiv — wenn du ihn später startest und auf `local` umschaltest, funktioniert alles wie vorher.

Nach Approval setze ich in der oben genannten Reihenfolge um.
