
# Alle Thermostate auf Zieltemperatur setzen

## Aktueller Status der Räume

Aus der Datenbank (Stand: jetzt):

| Raum | Ist-Temp | Soll-Temp | Heizend | Letzter Sync |
|---|---|---|---|---|
| Bad Uli | 19.5°C | 20°C | Ja | 17:15 |
| Büro | 20.3°C | 20°C | Nein | 17:15 |
| Flur | 19.5°C | 19°C | Nein | 17:15 |
| Haustür | 19.7°C | 18°C | Nein | 15:30 |
| Kinder Bad | 18.7°C | 19°C | Ja | 17:15 |
| Toilette Eingang | 20.1°C | 17°C | Nein | 15:02 |
| Waschraum | 18.3°C | 19°C | Ja | 17:15 |
| Wirtschaftsraum | 18.7°C | 19°C | Ja | 17:15 |
| Wohnzimmer | 21.3°C | 20°C | Nein | 17:15 |
| Zimmer Luca | 19.2°C | 19°C | Nein | 15:02 |
| Zimmer Luis | 19.7°C | 20°C | Nein | 16:30 |
| Zimmer Uli | 19.6°C | 20°C | Ja | 15:15 |

## Was wird gemacht

Ein neuer Endpoint `/push-all-temps` wird in der `tuya-control` Edge Function hinzugefügt. Dieser liest für jeden Raum die `target_temp` aus der Datenbank und schickt sie direkt an die Tuya Cloud API - unabhängig vom aktuellen Ist-Stand.

Zusätzlich wird ein Button in der UI ergänzt (im Heizungs-Dashboard oder in den ThermostatCard-Einstellungen), mit dem man diese Aktion manuell auslösen kann.

## Technische Umsetzung

### 1. Neuer Edge Function Endpoint: `/push-all-temps`

In `supabase/functions/tuya-control/index.ts` wird vor dem abschließenden `return 404` ein neuer Handler eingetragen:

```
POST /push-all-temps
- Liest alle Räume mit tuya_device_id und target_temp aus der DB
- Ruft für jeden Raum setDeviceTemperature(deviceId, target_temp) auf
- Gibt eine Zusammenfassung zurück (erfolgreich, fehlgeschlagen, übersprungen)
- Respektiert den Cloud/Lokal-Modus-Guard (blockiert wenn local mode)
```

### 2. Neuer Hook `usePushAllTemps`

Ein einfacher Hook in `src/hooks/usePushAllTemps.ts` der den neuen Endpoint aufruft und den Loading-State verwaltet.

### 3. UI-Button im Heizungs-Dashboard

In `src/components/heating/HeatingDashboard.tsx` oder `src/components/heating/RoomStatusTable.tsx` wird ein Button "Alle Temperaturen synchronisieren" hinzugefügt. Beim Klick:
- Zeigt Loading-Spinner
- Ruft den neuen Endpoint auf
- Zeigt Ergebnis als Toast (z.B. "12/12 Thermostate aktualisiert")

## Ablauf

```text
User klickt Button
        |
        v
usePushAllTemps Hook
        |
        v
supabase.functions.invoke('tuya-control/push-all-temps')
        |
        v
Edge Function: Liest alle Räume aus DB
        |
        v
Für jeden Raum: setDeviceTemperature(deviceId, target_temp)
        |
        v
Tuya Cloud API → Befehl an physisches Gerät
        |
        v
DB Update: last_thermostat_sync aktualisiert
        |
        v
Toast: "X/12 Thermostate aktualisiert"
```

## Hinweis zu Quota

Das Senden von 12 einzelnen `set-temp` Befehlen verbraucht 12 Tuya API-Calls (plus 1 für den Token). Bei der Trial Edition (1000 Calls/Monat) ist das vertretbar wenn es manuell ausgelöst wird.

Räume wo current_temp bereits === target_temp werden trotzdem gesendet, da der physische Thermostat möglicherweise eine andere Temperatur anzeigt als die Datenbank.
