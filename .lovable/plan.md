

# useTuyaControl.ts auf Command-Queue umstellen

## Was wird geaendert

Die Datei `src/hooks/useTuyaControl.ts` wird so umgebaut, dass Temperatur-Befehle nicht mehr die Cloud Edge Function (`tuya-control/set-temp`) aufrufen, sondern einen Eintrag in die `thermostat_commands`-Tabelle schreiben. Der lokale `tuya-thermostat/index.js` liest diese Befehle alle 5 Sekunden und fuehrt sie via LAN (Port 6668) aus.

## Aenderungen

### setTemperature() - Neuer Ablauf

Statt:
```text
supabase.functions.invoke('tuya-control/set-temp', { body: { deviceId, temperature, roomId } })
```

Wird:
```text
supabase.from('thermostat_commands').insert({
  room_id: roomId,
  command: 'set_temp',
  value: temperature,
  status: 'pending'
})
```

Zusaetzlich bleibt bestehen:
- Manual Override fuer 2 Stunden in der `rooms`-Tabelle
- Toast-Meldung "Temperatur-Befehl gesendet" (statt "gesetzt", da asynchron)

### syncAllStatus() - Vereinfachen

Statt die Cloud Edge Function `tuya-control/sync-all` aufzurufen, liest die Funktion direkt die aktuellen Daten aus der `rooms`-Tabelle. Der lokale Service aktualisiert diese Daten bereits alle 60 Sekunden.

### getStatus() - Vereinfachen

Liest den Status direkt aus der `rooms`-Tabelle (`current_temp`, `target_temp`, `is_heating`) statt ueber die Edge Function.

### fetchDevices() - Entfernen oder vereinfachen

Die Cloud-API-basierte Device-Liste wird nicht mehr benoetigt, da die Geraete lokal gesteuert werden. Die Funktion wird vereinfacht oder entfernt.

## Keine Datenbank-Aenderungen noetig

Die `thermostat_commands`-Tabelle existiert bereits mit allen benoetigten Spalten:
- `id` (UUID, auto)
- `room_id` (UUID)
- `command` (text)
- `value` (numeric)
- `status` (text, default: 'pending')
- `error_message` (text)
- `created_at` (timestamptz)
- `executed_at` (timestamptz)

## Betroffene Datei

| Datei | Aenderung |
|-------|-----------|
| `src/hooks/useTuyaControl.ts` | Von Cloud Edge Function auf Command-Queue umstellen |

