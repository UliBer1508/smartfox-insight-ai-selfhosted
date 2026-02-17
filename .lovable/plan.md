

# Dual-Modus Schalter: Cloud API / Lokaler Service

## Uebersicht

Implementierung eines Umschalters in den Einstellungen, der zwischen zwei vollstaendig getrennten Steuerungsmodi wechselt:

- **Cloud API**: Edge Functions (`tuya-control`, `pv-automation`, `apply-recommendations`) rufen die Tuya Cloud API direkt auf
- **Lokaler Service**: Alle Temperatur-Befehle werden als Eintraege in die `thermostat_commands`-Tabelle geschrieben, der lokale Node.js Collector fuehrt sie aus

Beide Modi muessen absolut eigenstaendig laufen - kein Modus darf den Kanal des anderen nutzen.

## Aktueller Zustand

- `system_settings` enthaelt bereits `tuya_control_mode = { mode: "cloud" }` -- wird aber **nirgends im Code ausgelesen**
- Alle Edge Functions (`pv-automation`, `apply-recommendations`, `tuya-control`) rufen **immer** die Tuya Cloud API direkt auf
- `useTuyaControl.setTemperature()` ruft **immer** die Edge Function `tuya-control/set-temp` auf (Cloud API)
- Der lokale Collector verarbeitet Befehle aus `thermostat_commands`, aber niemand schreibt dort hinein

## Aenderungen

### 1. Neuer Hook: `useControlMode` (Frontend)

Neuer Hook `src/hooks/useControlMode.ts`:
- Liest `tuya_control_mode` aus `system_settings`
- Gibt `mode: 'cloud' | 'local'` zurueck
- Stellt `setMode()` Funktion bereit
- Cacht den Wert mit React Query

### 2. Settings-UI: Modus-Schalter

In `src/components/energy/SettingsPanel.tsx` im Tuya-Abschnitt:
- Radio-Group oder SegmentedControl mit zwei Optionen:
  - "Cloud API" -- Thermostate werden ueber die Tuya Cloud gesteuert
  - "Lokaler Service" -- Befehle werden an den lokalen Collector gesendet
- Kurze Erklaerung unter jeder Option
- Warnung beim Wechsel, dass der andere Modus deaktiviert wird

### 3. `useTuyaControl.setTemperature()` -- Modus-Weiche

Die zentrale Aenderung im Frontend. `setTemperature()` prueft den Modus:

**Cloud-Modus (wie bisher):**
```text
supabase.functions.invoke('tuya-control/set-temp', { body: { deviceId, temperature, roomId } })
```

**Lokal-Modus (neu):**
```text
supabase.from('thermostat_commands').insert({
  room_id: roomId,
  command: 'set_temp',
  value: temperature,
  status: 'pending'
})
```

Kein Cloud-API-Aufruf, kein Edge-Function-Call. Der lokale Collector nimmt den Befehl auf.

### 4. `useTuyaControl.syncAllStatus()` -- Modus-Weiche

**Cloud-Modus:** Ruft `tuya-control/sync-all` auf (Batch-API, wie bisher)

**Lokal-Modus:** Liest nur die `rooms`-Tabelle aus (Daten kommen vom lokalen Collector). Kein Edge-Function-Call.

### 5. Edge Function `pv-automation` -- Modus-Weiche

Die groesste Aenderung. Am Anfang des `/check`-Handlers:

```text
// Modus aus system_settings laden
const { data: modeSetting } = await supabase
  .from('system_settings')
  .select('value')
  .eq('key', 'tuya_control_mode')
  .maybeSingle();

const controlMode = modeSetting?.value?.mode || 'cloud';
```

Dann bei **jeder** Stelle wo `setDeviceTemperature()` aufgerufen wird:

**Cloud-Modus:** `setDeviceTemperature(accessId, accessSecret, deviceId, temp)` (wie bisher)

**Lokal-Modus:** Statt Tuya-API-Call einen Eintrag in `thermostat_commands` schreiben:
```text
await supabase.from('thermostat_commands').insert({
  room_id: roomId,
  command: 'set_temp',
  value: targetTemp,
  status: 'pending'
});
```

Dies betrifft:
- Nachtmodus-Absenkung (ca. Zeile 459)
- Alle activate/deactivate Aktionen (ca. Zeile 1330-1430)

### 6. Edge Function `apply-recommendations` -- Modus-Weiche

Gleiche Logik: `controlMode` laden und bei `setDeviceTemperature()` (Zeile 374) entweder Cloud-API oder `thermostat_commands`-Insert verwenden.

### 7. Edge Function `tuya-control` -- Modus-Guard

Der `/set-temp`-Endpoint bekommt einen Guard:

```text
// Wenn Modus = local, lehne Cloud-Befehle ab
if (controlMode === 'local') {
  return new Response(JSON.stringify({
    success: false,
    error: 'Cloud-Modus deaktiviert. Bitte lokalen Service verwenden.'
  }), { status: 403, headers: ... });
}
```

Und `/sync-all` gibt im Local-Modus nur die DB-Daten zurueck (kein Tuya-API-Call).

## Technische Details

### Betroffene Dateien

| Datei | Aenderung |
|---|---|
| `src/hooks/useControlMode.ts` | **Neu** - Hook fuer Modus-Verwaltung |
| `src/hooks/useTuyaControl.ts` | Modus-Weiche in `setTemperature()` und `syncAllStatus()` |
| `src/components/energy/SettingsPanel.tsx` | UI fuer Modus-Schalter |
| `supabase/functions/pv-automation/index.ts` | Modus-Weiche bei allen `setDeviceTemperature()`-Aufrufen |
| `supabase/functions/apply-recommendations/index.ts` | Modus-Weiche bei `setDeviceTemperature()` |
| `supabase/functions/tuya-control/index.ts` | Guard gegen falsche Modus-Nutzung |

### Keine Datenbank-Migration noetig

`system_settings` mit Key `tuya_control_mode` existiert bereits.

### Sicherstellung der Trennung

- **Cloud-Modus aktiv:** Edge Functions rufen Tuya API direkt auf. `thermostat_commands` wird NICHT beschrieben. Lokaler Collector hat nichts zu tun.
- **Lokal-Modus aktiv:** Edge Functions schreiben NUR in `thermostat_commands`. Tuya API wird NICHT aufgerufen. `tuya-control/set-temp` lehnt direkte Aufrufe ab. Lokaler Collector verarbeitet die Befehle.

