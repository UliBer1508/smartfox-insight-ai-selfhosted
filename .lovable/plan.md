## Aktion

Haustür wieder voll in die Automation aufnehmen — wie alle anderen Räume.

## DB-Updates

**1. Raum-Flags reaktivieren** (`rooms`-Tabelle, Haustür):
- `automation_enabled = true`
- `pv_auto_enabled = true`
- `heating_paused_reason = null` (alter night_frost_failed-Marker entfernen)
- `target_temp = 19` (Eco — wie andere Tag-Räume)

**2. Local-Command queuen** (`thermostat_commands`):
- `set_temp` auf 19°C → wird vom laufenden Local-Service in Pötschach automatisch abgeholt und physisch gesetzt.

```sql
UPDATE rooms
SET automation_enabled = true,
    pv_auto_enabled = true,
    heating_paused_reason = NULL,
    target_temp = 19,
    updated_at = NOW()
WHERE name = 'Haustür';

INSERT INTO thermostat_commands (room_id, command, value, status)
SELECT id, 'set_temp', 19, 'pending' FROM rooms WHERE name = 'Haustür';
```

## Resultat

- Local-Service holt Command innerhalb ~45s ab → Thermostat physisch auf 19°C
- Ab nächstem PV-Automation-Lauf (alle 2min) wird die Haustür wie alle anderen Räume nach Budget/PV gesteuert
- Nachts wird sie zusammen mit dem Rest auf Frost (16°C) zurückgestellt