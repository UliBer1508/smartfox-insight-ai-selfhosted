

# Steuerungsmodus-Schalter: Cloud vs. Lokal

## Uebersicht

In den Einstellungen wird ein neuer Schalter hinzugefuegt, mit dem zwischen zwei Steuerungsmodi gewechselt werden kann:

- **Cloud**: Befehle gehen ueber die Edge Function (bisheriges Verhalten)
- **Lokal**: Befehle werden in die `thermostat_commands`-Tabelle geschrieben und vom lokalen Service ausgefuehrt

## Aenderungen

### 1. Einstellung in der Datenbank speichern

Ein neuer Eintrag in `system_settings` mit Key `tuya_control_mode` und Wert `{ "mode": "cloud" }` oder `{ "mode": "local" }`. Keine Migration noetig, da die Tabelle bereits existiert.

### 2. Neuer Hook: `useTuyaControlMode.ts`

- Liest den aktuellen Modus aus `system_settings` (Key: `tuya_control_mode`)
- Bietet eine Funktion `setMode('cloud' | 'local')` zum Umschalten
- Standardwert: `cloud` (wenn kein Eintrag existiert)

### 3. Neues Settings-Widget: `TuyaControlModeSwitch.tsx`

Ein kompaktes UI-Element im Tuya-Bereich der Einstellungen:
- Label "Steuerungsmodus"
- Zwei Optionen: "Cloud API" und "Lokaler Service"
- Kurze Erklaerung je nach Modus
- Cloud: "Befehle werden ueber die Cloud Edge Function gesendet"
- Lokal: "Befehle werden vom lokalen tuya-thermostat Service ausgefuehrt"

### 4. `useTuyaControl.ts` anpassen

Die `setTemperature()`-Funktion prueft den aktuellen Modus:

```text
WENN mode === 'cloud':
  supabase.functions.invoke('tuya-control/set-temp', ...)  (bisheriger Code)

WENN mode === 'local':
  supabase.from('thermostat_commands').insert({
    room_id, command: 'set_temp', value: temperature, status: 'pending'
  })
```

Ebenso fuer `syncAllStatus()` und `getStatus()`:
- Cloud-Modus: Edge Function aufrufen (bisherig)
- Lokal-Modus: Direkt aus `rooms`-Tabelle lesen

### 5. SettingsPanel.tsx erweitern

Das neue `TuyaControlModeSwitch`-Widget wird im Tuya-Accordion-Bereich eingefuegt, oberhalb des bestehenden `TuyaConnectionTest`.

## Betroffene Dateien

| Datei | Aenderung |
|-------|-----------|
| `src/hooks/useTuyaControlMode.ts` | Neu - Hook zum Lesen/Setzen des Modus |
| `src/components/settings/TuyaControlModeSwitch.tsx` | Neu - Schalter-Widget |
| `src/hooks/useTuyaControl.ts` | Angepasst - Beide Pfade (Cloud/Lokal) |
| `src/components/energy/SettingsPanel.tsx` | Erweitert - Widget einbinden |

