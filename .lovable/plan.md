## Ziel
Bis 08:00 Vienna stehen **alle** Räume zuverlässig auf Nacht-Setpoint (5°C bei `frost_only`), keine Ausnahmen durch `auto`-Modus am Thermostat.

## Sofort-Fix (jetzt anwenden)

1. **`thermostat_commands` einfügen** für die zwei Ausreißer — pro Raum **zwei** Commands:
   - `mode = manual` (zwingt Thermostat aus dem Schedule raus)
   - `set_temperature = 5`
   
   Räume:
   - Wirtschaftsraum
   - Toilette Eingang
   
2. Dadurch holt der lokale Tuya-Service die Commands binnen 5s ab, schreibt sie via DPS 2 + DPS 4 → Thermostat folgt wieder unserem Setpoint.

3. **`heating_paused_reason` leeren** für alle Räume, deren `last_thermostat_sync` jünger als 5 Min ist (Service ist nachweislich wieder online).

## Strukturelle Absicherung (Code-Änderung)

Im **`pv-automation` Edge Function** (alleinige Setpoint-Autorität) bei jeder Nacht-Phase folgendes ergänzen:

- **Mode-Guard:** Vor jedem Setpoint-Write prüfen, ob letzter bekannter Mode (aus `service_health` / `room_temperature_samples` Metadaten oder neuem Feld) ≠ `manual` → zusätzlichen `set_mode=manual` Command vorschalten.
- **Effektivitäts-Check:** Wenn nach 2 Sync-Zyklen (=2 min) `target_temp` aus dem Sync nicht dem zuletzt geschriebenen Wert entspricht → Mode-Reset + Setpoint erneut schreiben.
- **Reason-Cleanup:** Nach jedem erfolgreichen Sync (`last_thermostat_sync` < 2 Min alt) `heating_paused_reason` zurücksetzen, wenn der Grund mit `'... Lokaler Service offline ...'` beginnt.

## Optional: Reporting

Settings-Banner: „X Räume im Auto-Modus — wird automatisch korrigiert" mit Liste der betroffenen Räume, solange Mismatch besteht.

## Reihenfolge

1. Sofort-Fix per `INSERT INTO thermostat_commands` + `UPDATE rooms SET heating_paused_reason = NULL` (kein Code-Deploy nötig).
2. Anschließend pv-automation Patch (Mode-Guard + Reason-Cleanup) + Deploy.

## Bestätigung nötig

Soll ich Schritt 1 (Sofort-Fix per Insert) **jetzt direkt** ausführen, und Schritt 2 (Code-Änderung) danach implementieren?