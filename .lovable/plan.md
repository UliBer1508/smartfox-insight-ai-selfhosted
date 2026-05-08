## Problem

Im Lokal-Modus queued `pv-automation` vor jedem `set_temp` zusätzlich ein `set_mode`-Command mit numerischem `value: 0`. Der v2-Service erwartet aber Strings (`auto` / `manual` / `off`) → `CMD ERR: Ungültiger Modus: 0`.

**Folgen aus den Logs:**
- 11 `set_mode`-Errors pro Automation-Lauf (alle ~2 Min)
- Das nachfolgende `set_temp` läuft jedes Mal sauber durch (`CMD OK`)
- Heizungssteuerung funktioniert vollständig — nur `api_errors` füllt sich mit Lärm und das UI-Banner blinkt rot

**Warum ist `set_mode` überflüssig?**  
`tuya-thermostat.js` setzt im v2-Service in `setTemperature()` atomar `mode='manual'` + `target_temp` in einem Roundtrip:
```js
device.set({ multiple: true, data: { [MODE]: 'manual', [TARGET_TEMP]: tempValue } })
```
Das vorgeschaltete `set_mode`-Command ist Legacy-Ballast aus der Cloud-Ära.

## Fix

**Eine Code-Änderung in einer Datei:**  
`supabase/functions/pv-automation/index.ts` → Funktion `queueLocalTemperatureCommand` (~Zeile 415–455): den `set_mode`-Insert ersatzlos entfernen. Nur noch `set_temp` einreihen.

```ts
// ENTFERNT: redundanter set_mode-Insert (v2-Service setzt mode atomar in setTemperature)
const { error } = await supabase.from('thermostat_commands').insert({
  room_id: roomId,
  command: 'set_temp',
  value: temperature,
  status: 'pending',
});
```

## Aufräumen (gleicher Schritt)

Bestehende „Ungültiger Modus"-Einträge der letzten Stunde als resolved markieren, damit das Banner sich beruhigt:

```sql
UPDATE api_errors
SET resolved_at = now()
WHERE source = 'tuya-local'
  AND error_message LIKE '%Ungültiger Modus%'
  AND resolved_at IS NULL;
```

## Verifikation nach Deploy

1. Edge Function deployt automatisch
2. Nächster Automation-Lauf (~2 Min): in den Service-Logs erscheinen **nur noch** `CMD OK Raum: set_temp=XX` — keine `Ungültiger Modus`-Errors mehr
3. `api_errors`-Tabelle bekommt keine neuen Einträge mit dieser Meldung
4. Heizungssteuerung läuft unverändert (Temperaturen werden weiter korrekt gesetzt)

## Was NICHT geändert wird

- Lokaler v2-Service auf dem PC bleibt unangetastet
- DB-Schema bleibt unverändert
- Cloud-Pfad in `tuya-control` bleibt funktional
- UI-Buttons (manuelles Set-Temp im Frontend) — falls die ebenfalls `set_mode` queuen, prüfen wir das in einem zweiten kleinen Lauf
