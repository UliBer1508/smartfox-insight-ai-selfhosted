
# Plan: Tuya Mode-Befehl entfernen - Sequenzielles Heizen aktivieren

## Problem-Zusammenfassung

### Aktuelle Situation

| Raum | Aktuell | Ziel | Heizt? | Problem |
|------|---------|------|--------|---------|
| Wohnzimmer | 19.4°C | 18°C | JA | Sollte AUS sein! |
| Büro | 19.0°C | 18°C | JA | Sollte AUS sein! |
| Zimmer Luca | 18.8°C | 18°C | JA | Sollte AUS sein! |
| Bad Uli | 19.8°C | 18°C | JA | Sollte AUS sein! |

### Root-Cause: `mode: 'home'` Befehl schlägt fehl

Die Tuya API zeigt: **TGP508 unterstützt NUR `mode: 'auto'` über Cloud!**

```json
"mode": { "range": ["auto"] }  // Kein "home" verfügbar!
```

Wir senden:
```
commands: [
  { code: 'mode', value: 'home' },  // ERROR 2008!
  { code: 'temp_set', value: 180 }   // Wird NICHT ausgeführt!
]
```

**Der fehlgeschlagene Mode-Befehl blockiert den gesamten API-Call!**

## Lösung

### Schritt 1: Mode-Befehl komplett entfernen

In beiden Edge Functions den `mode: 'home'` Befehl entfernen:

**`supabase/functions/pv-automation/index.ts`** (Zeile 265-267):
```typescript
// VORHER:
if (forceHomeMode) {
  commands.push({ code: 'mode', value: 'home' });
}

// NACHHER:
// Mode-Befehl entfernt - TGP508 unterstützt nur 'auto' über Cloud API
// Thermostate im "Programmiermodus" folgen temp_set Befehlen
```

**`supabase/functions/tuya-control/index.ts`** (Zeile 236-239):
```typescript
// VORHER:
if (forceHomeMode) {
  commands.push({ code: 'mode', value: 'home' });
}

// NACHHER:
// Mode-Befehl entfernt - TGP508 unterstützt nur 'auto' über Cloud API
```

### Schritt 2: Memory aktualisieren

Die falsche Annahme korrigieren:

**Bisherige Memory (falsch):**
> `home` mode = manual control, `auto` mode = internal schedules

**Neue Memory (korrekt):**
> TGP508 über Cloud-API: Nur `auto` Modus verfügbar. Im "Programmiermodus" am Gerät folgen die Thermostate den Cloud `temp_set` Befehlen. Der Mode-Befehl `home` existiert nicht in der Cloud-API.

### Erwartetes Ergebnis nach Fix

1. **API-Calls werden erfolgreich:**
   ```
   [Tuya] bf82... -> 22°C: success=true (statt code=2008)
   ```

2. **Thermostate folgen den Befehlen:**
   - Zimmer Luca → 22°C (aktiv heizen mit PV)
   - Alle anderen → 18°C (Pause, kein Heizen)

3. **Verbrauch sinkt:**
   - Vorher: 4.1 kW (alle heizen autonom)
   - Nachher: ~1 kW (nur 1 Raum heizt)

## Dateiänderungen

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | `forceHomeMode` Logik entfernen (Zeilen 265-267) |
| `supabase/functions/tuya-control/index.ts` | `forceHomeMode` Parameter und Logik entfernen |

## Test nach Deployment

1. pv-automation manuell triggern
2. Logs prüfen: `success=true` für alle temp_set Befehle
3. Nach 2-3 Minuten Raumstatus prüfen: nur 1 Raum sollte heizen
4. Dashboard prüfen: Netzbezug sollte auf ~0W sinken
