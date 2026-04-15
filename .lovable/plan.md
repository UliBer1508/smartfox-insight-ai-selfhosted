

## Plan: Räume manuell auf Komfort setzen (Quota-Workaround)

### Problem
Die Tuya Cloud API Quota (30 Calls/Tag) ist aufgebraucht. Die pv-automation berechnet korrekt Eco/Komfort-Ziele, kann aber keine Befehle senden. Viele Räume stehen noch auf 5°C oder 18°C in der DB.

### Lösung: DB-Update + Lokale Commands queuen

**1. DB-Migration: Alle Räume auf Komfort-Temperatur setzen**

```sql
UPDATE rooms SET target_temp = comfort_temp WHERE target_temp < comfort_temp;
```

Das setzt alle 12 Räume sofort auf ihre jeweilige Komfort-Temperatur (19-22°C).

**2. Thermostat-Commands für lokalen Collector queuen**

Für jeden Raum mit `tuya_device_id` einen `set_temp`-Befehl in `thermostat_commands` einfügen:

```sql
INSERT INTO thermostat_commands (room_id, command, value, status)
SELECT id, 'set_temp', comfort_temp, 'pending'
FROM rooms WHERE tuya_device_id IS NOT NULL;
```

Falls der lokale Collector läuft, werden diese Commands ausgeführt — ohne API-Quota.

**3. Zusätzlich: `set_mode` Commands queuen**

```sql
INSERT INTO thermostat_commands (room_id, command, value, status)
SELECT id, 'set_mode', 0, 'pending'
FROM rooms WHERE tuya_device_id IS NOT NULL;
```

### Auswirkung
- DB zeigt sofort korrekte Komfort-Werte
- Lokaler Collector (falls aktiv) setzt die physischen Thermostate
- Kein API-Quota-Verbrauch

