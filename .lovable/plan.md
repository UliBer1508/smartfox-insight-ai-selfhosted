## Problem

Es ist 20:10 Uhr Wien. Nachtmodus (`night_start_time = 20:00`, `mode = frost_only`) ist aktiv, aber die Thermostate haben noch Tag-Werte (Bad Uli 21°, Wohnzimmer 22°, Kinder Bad/Luis/Luca 21°).

### Ursachen

1. **Night-Quiet-Gate blockiert weitere Versuche.** `system_settings.night_frost_last_pushed = "2026-04-28"` ist gesetzt — die Edge Function überspringt jeden weiteren Push-Versuch dieser Nacht.
2. **Tuya-Cloud-Quota erschöpft** (33/30 heute, 3840/3000 Monat). Selbst ohne Gate würden Cloud-Calls aktuell scheitern.
3. **Local-Steuerkanal nicht aktiv** (`lastLocalExec=none`) — der lokale Tuya-Service sendet keine Heartbeats, also kein Fallback verfügbar.
4. **Letzter Push um 20:09** hat die `target_temp`-Werte aus der DB gesendet (gemischte Eco/Komfort-Werte), nicht den Frost-Wert (5°C). Dadurch hängen die Räume jetzt auf Tag-Targets fest.

## Lösung

### Schritt 1 — Night-Frost-Gate zurücksetzen
`DELETE` (bzw. `UPSERT` mit leerem Wert) auf `system_settings.night_frost_last_pushed`, damit die nächste `pv-automation` Ausführung den Frost-Push erneut versucht.

### Schritt 2 — Quota-Logik prüfen / Frost-Push priorisieren
Den Frost-Only-Push in `pv-automation/index.ts` so ändern, dass er **vor** dem Quota-Check läuft (oder Quota-Check umgeht). Argumentation: 1× Push pro Nacht ist sicherheitskritisch (Frostschutz) und darf nicht an Quota scheitern. Das Gate sorgt ja bereits dafür, dass es nur 1× passiert.

### Schritt 3 — `target_temp` für Nacht setzen
Direkt in `rooms.target_temp` für alle automatisierten Räume den jeweiligen `night_temp` (bzw. 5°C bei `frost_only`) eintragen — als DB-Update. Dadurch wird der nächste `push-all-temps` Lauf die richtigen Werte senden, falls die Edge Function das so verwendet.

### Schritt 4 — Local-Service-Status klären
Im Hintergrund prüfen warum `lastLocalExec=none`. Der Node-Collector (`local-collector/collector-node/index.js`) muss laufen und Heartbeats schreiben, sonst gibt es keinen Cloud-Quota-Fallback. Das ist nicht in dieser Edge-Function-Session lösbar — dem User mitteilen.

### Schritt 5 — Quota-Reset-Doku
Dem User erklären: Der Tuya-Quota-Reset erfolgt täglich um Mitternacht UTC. Bis dahin sind keine weiteren Cloud-Calls möglich, außer wir erlauben dem Frost-Push einen "Notfall-Override" (siehe Schritt 2).

## Technische Änderungen

- **DB-Migration / Insert:** `UPDATE system_settings SET value = '{}'::jsonb WHERE key = 'night_frost_last_pushed';`
- **DB-Update rooms:** Für alle Räume mit `automation_enabled = true` → `target_temp = 5` (frost_only Modus).
- **Edge Function `pv-automation/index.ts`:** Im Night-Block den Frost-Push **vor** dem Quota-Check ausführen (oder Quota-Check für diesen einen Pfad überspringen, wenn `night_frost_last_pushed != nightKey`).
- **`tuya-control` `/push-all-temps`:** Prüfen ob es `night_temp` berücksichtigt wenn `isNight=true` — falls nicht, ergänzen.
- **Manueller Trigger:** Nach den Fixes einmalig `pv-automation` aufrufen, damit der Frost-Push sofort losgeht.

## Erwartetes Ergebnis

Innerhalb von ~30 s nach Fix sind alle automatisierten Räume auf 5°C (Frostschutz) gesetzt, das `night_frost_last_pushed` Gate ist gesetzt, und die Edge Function bleibt bis 08:00 Uhr morgen früh im Quiet Mode.
