
## Plan: Implementierung einer Mode-Umschalter-Funktion

### Analyse der bestehenden Struktur

Die `tuya-control` Edge Function hat bereits mehrere Endpoints:
- `POST /status` - Status abrufen
- `POST /set-temp` - Temperatur setzen
- `POST /sync-all` - Alle Thermostate synchronisieren
- `POST /test` - Verbindung testen
- `POST /set-region` - Region umschalten

### Problem

Alle TGP508 Thermostate sind derzeit im Modus `"home"` (automatischer Modus mit internen Zeitplänen). Sie müssen auf `"manual"` umgeschaltet werden, damit die Cloud-basierten Befehle gelten.

### Lösung: Neue Funktion `setDeviceMode()`

**Schritt 1:** Neue Hilfsfunktion erstellen (nach Zeile 236, vor `parseThermostatStatus`):
```typescript
// Set device mode (manual/home/off)
async function setDeviceMode(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  mode: string
): Promise<unknown> {
  // Tuya expects 'mode' code with values like 'manual', 'home', 'off'
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [
      { code: 'mode', value: mode }
    ]
  });
}
```

**Schritt 2:** Neuer Endpoint `POST /set-mode-all` vor dem finalen `Deno.serve()` (vor Zeile 278):
```typescript
// POST /set-mode-all - Set manual mode for all thermostats
if (req.method === 'POST' && path === '/set-mode-all') {
  const { data: rooms } = await supabase
    .from('rooms')
    .select('*')
    .not('tuya_device_id', 'is', null);

  if (!rooms || rooms.length === 0) {
    return new Response(JSON.stringify({ success: true, results: [], message: 'No rooms configured' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results = [];
  for (const room of rooms) {
    try {
      // Set device to manual mode
      await setDeviceMode(accessId, accessSecret, room.tuya_device_id, 'manual');
      results.push({ roomId: room.id, name: room.name, success: true, mode: 'manual' });
      console.log(`[${room.name}] Mode set to manual`);
    } catch (error) {
      console.error(`Error setting mode for room ${room.name}:`, error);
      results.push({ roomId: room.id, name: room.name, success: false, error: String(error) });
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

**Schritt 3:** Vorhandene Funktion `setDeviceTemperature()` erweitern (Zeile 221-236):
```typescript
// Set device temperature (AND ensure manual mode)
async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<unknown> {
  const tempValue = Math.round(temperature * 10);
  
  // IMPORTANT: Send both mode and temperature to ensure manual mode is active
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [
      { code: 'mode', value: 'manual' },    // Force manual mode
      { code: 'temp_set', value: tempValue }
    ]
  });
}
```

### Verwandte Änderungen

1. **`setDeviceTemperature()` Update**: Die bestehende Funktion wird erweitert, um automatisch `manual` mode zu setzen, damit Temperaturänderungen sofort wirksam werden.

2. **Neuer Endpoint `/set-mode-all`**: Ermöglicht das Umschalten aller Thermostate auf `manual` mode mit einem API-Call. Dies wird alle 10 Thermostate verarbeiten und die Ergebnisse returnieren.

### Erwartetes Ergebnis

Nach der Implementierung:
1. **Sofort-Fix**: Ein einziger API-Call zu `/set-mode-all` schaltet alle Thermostate auf `manual` um
2. **Zukunft**: Jeder nachfolgende Temperaturbefehl setzt automatisch den `manual` mode, um Rückfälle zu verhindern
3. **Nachtmodus**: Die `pv-automation` kann jetzt garantieren, dass Thermostate die 18°C Nachttemperatur respektieren

### Zusammenfassung der Änderungen

| Änderung | Datei | Zeile |
|----------|-------|-------|
| Neue Funktion `setDeviceMode()` | `supabase/functions/tuya-control/index.ts` | ~237-247 |
| Erweiterte `setDeviceTemperature()` | `supabase/functions/tuya-control/index.ts` | ~221-236 |
| Neuer Endpoint `/set-mode-all` | `supabase/functions/tuya-control/index.ts` | Vor Deno.serve() |

Die Funktion wird nach der Implementierung automatisch deployed und kann sofort getestet werden mit:
```javascript
await supabase.functions.invoke('tuya-control/set-mode-all', { body: {} })
```

