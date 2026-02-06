
# Problem: Nachtmodus wird nie auf Thermostate uebertragen

## Analyse

Das Problem liegt in der `pv-automation` Edge Function:

```text
Zeile 297-307:
if (isNight) {
  console.log("Night mode active - skipping cloud sync...")
  return { success: true, nightMode: true }  // <-- FRUEHE RUECKGABE!
}
```

**Aktueller Ablauf:**
1. Um 22:00 beginnt Nachtmodus
2. pv-automation prueft: `isNight = true`
3. Sofortige Rueckgabe - KEIN Code danach wird ausgefuehrt
4. Thermostate bleiben auf ihrer letzten Temperatur (19-20°C)
5. Thermostate heizen weiter, weil target > current

**Beweis (Live-Sync gerade eben):**

| Raum | Tuya target | DB night_temp | Differenz |
|------|-------------|---------------|-----------|
| Bad Uli | 20°C | 18°C | +2°C |
| Zimmer Uli | 20°C | 18°C | +2°C |
| Buero | 19°C | 18°C | +1°C |
| Wohnzimmer | 19°C | 18°C | +1°C |
| alle anderen | 19°C | 18°C | +1°C |

Die Thermostate sind tatsaechlich NICHT auf night_temp!

---

## Loesung

### Ansatz: Nachtmodus EINMAL zu Beginn setzen

Statt die pv-automation komplett zu ueberspringen, soll sie:
1. Beim Start der Nacht alle Thermostate auf night_temp setzen
2. Danach keine weiteren API-Calls machen (Quota sparen)

**Aenderung in `supabase/functions/pv-automation/index.ts`:**

```text
VORHER (Zeile 297-307):
if (isNight) {
  return { nightMode: true, results: [] }  // Kompletter Skip
}

NACHHER:
if (isNight) {
  // Pruefe ob Thermostate schon auf night_temp stehen
  const roomsNeedingNightAdjustment = rooms.filter(r => {
    const currentTarget = Number(r.target_temp) || 0;
    const nightTarget = r.night_temp || settings?.night_temp || 17;
    return Math.abs(currentTarget - nightTarget) >= 0.5;
  });
  
  if (roomsNeedingNightAdjustment.length === 0) {
    return { nightMode: true, message: "Alle Thermostate bereits auf Nachttemperatur" };
  }
  
  // Nur die fehlenden Raeume auf night_temp setzen
  for (const room of roomsNeedingNightAdjustment) {
    await setDeviceTemperature(room.tuya_device_id, room.night_temp);
    await supabase.from('rooms').update({ 
      target_temp: room.night_temp,
      pv_auto_active: false 
    }).eq('id', room.id);
  }
  
  return { nightMode: true, adjusted: roomsNeedingNightAdjustment.length };
}
```

---

## Zusammenfassung der Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/pv-automation/index.ts` | Nachtmodus-Logik: Thermostate aktiv auf night_temp setzen statt komplett ueberspringen |

### Erwartetes Ergebnis

- Um 22:00: Alle Thermostate werden auf 18°C (night_temp) gesetzt
- 22:01-07:59: Keine weiteren API-Calls (Quota wird gespart)
- Thermostate heizen nicht mehr ueber Nacht, weil target = night_temp

### Sofort-Workaround

Alternativ kann ich jetzt alle Thermostate manuell auf 18°C setzen, um das Problem fuer heute Nacht zu loesen, waehrend die Code-Aenderung implementiert wird.
