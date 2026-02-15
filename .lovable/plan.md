

# Edge Functions: Cloud/Lokal Dual-Modus

## Uebersicht

Beide Edge Functions (`pv-automation` und `apply-recommendations`) rufen aktuell `setDeviceTemperature()` direkt ueber die Tuya Cloud API auf. Sie muessen den `tuya_control_mode` aus der `system_settings`-Tabelle lesen und je nach Modus entweder die Cloud API nutzen oder einen Befehl in die `thermostat_commands`-Tabelle schreiben.

## Technischer Ansatz

### Neue Helper-Funktion in beiden Edge Functions

Eine neue Funktion `setTemperatureByMode()` wird eingefuehrt, die den Steuerungsmodus prueft:

```text
async function setTemperatureByMode(
  supabase, accessId, accessSecret, 
  deviceId, roomId, temperature, controlMode
):
  WENN controlMode === 'local':
    INSERT INTO thermostat_commands (room_id, command, value, status)
    VALUES (roomId, 'set_temp', temperature, 'pending')
    RETURN { success: true }
    
  SONST (cloud):
    setDeviceTemperature(accessId, accessSecret, deviceId, temperature)
    RETURN result
```

### Modus einmalig laden

Zu Beginn jeder Edge-Function-Ausfuehrung wird der Modus einmal aus `system_settings` gelesen:

```text
SELECT value FROM system_settings WHERE key = 'tuya_control_mode'
-> controlMode = result?.value?.mode || 'cloud'
```

### Betroffene Stellen in pv-automation (3 Aufrufe)

1. **Zeile ~459**: Nachtmodus - Thermostate auf Nachttemperatur setzen
2. **Zeile ~1334**: Aktivierung - Thermostat auf Zieltemperatur setzen
3. **Zeile ~1388**: Deaktivierung - Thermostat auf reduzierte Temperatur setzen

Alle drei Aufrufe von `setDeviceTemperature()` werden durch `setTemperatureByMode()` ersetzt.

### Betroffene Stellen in apply-recommendations (1 Aufruf)

1. **Zeile ~374**: Empfohlene Temperatur anwenden

### Cloud-Credentials im Lokal-Modus

Im Lokal-Modus werden keine Tuya Cloud Credentials benoetigt. Die Pruefung `if (!accessId || !accessSecret)` wird angepasst: Im Lokal-Modus wird kein Fehler geworfen wenn die Credentials fehlen.

## Betroffene Dateien

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/pv-automation/index.ts` | Modus laden, `setTemperatureByMode()` einfuehren, 3 Aufrufe ersetzen |
| `supabase/functions/apply-recommendations/index.ts` | Modus laden, `setTemperatureByMode()` einfuehren, 1 Aufruf ersetzen, Credential-Check anpassen |

## Keine Datenbank-Aenderungen noetig

Die `thermostat_commands`-Tabelle und `system_settings`-Tabelle existieren bereits mit allen benoetigten Spalten und RLS-Policies.

