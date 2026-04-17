
## Plan: Räume aktiv auf Eco-Heizen setzen

### Aktuelle Situation
- pv-automation läuft alle 2 Min, schreibt korrekte target_temp in DB
- Quota wurde auf 200/Tag erhöht → Cloud-Calls sollten wieder funktionieren
- Manual Overrides sind gelöscht
- Mode-Sync (Error 2008) wurde entfernt

### Was ich machen werde

**1. Aktuellen Zustand prüfen** (read-only):
- `rooms`: current_temp, target_temp, eco_temp, is_heating für alle 12 Räume
- `system_settings`: aktueller Tuya Quota-Stand
- Letzte `pv-automation` Logs: läuft sie? Welche Räume werden aktiviert?
- Letzte `room_heating_logs`: gibt es Heating-Starts heute?

**2. Räume die heizen sollen identifizieren**
Ein Raum braucht Heizen wenn:
- `current_temp < eco_temp - 0.2` (Hysterese)
- Sortiert nach `priority` (1-12)

**3. DB-Update + Commands queuen**
Für alle Räume die heizen sollen:
- `target_temp = eco_temp` setzen (falls noch nicht)
- `set_temp` Command in `thermostat_commands` einfügen (Wert = eco_temp × 10)
- Alte pending Commands für diesen Raum vorher als `superseded` markieren

**4. tuya-control direkt aufrufen** für die Top-3 Prioritäten
- Umgeht die `pv-automation`-Wartezeit
- Setzt physisch die Thermostate sofort
- Verbraucht 3 Calls von 200 → unkritisch

**5. Verifikation nach 60 Sek**
- `is_heating` Status prüfen
- API-Errors checken
- Logs auswerten

### Erwartung
Räume mit `current_temp < eco_temp` starten innerhalb 1-2 Minuten zu heizen, sobald Tuya-Calls erfolgreich sind. Ohne Quota-Block und ohne Mode-Error 2008 sollten die `temp_set` Calls jetzt durchgehen.
