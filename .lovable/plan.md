

## Plan: Fehlende Variablen definieren — pv-automation crasht

### Problem
Die pv-automation Function crasht mit `ecoRoomsRemaining is not defined`. Zwei Variablen werden verwendet aber nie deklariert:
1. **`ecoRoomsRemaining`** — verwendet an 10 Stellen, nie definiert
2. **`batteryEcoReserveAllowed`** — verwendet an 15 Stellen, nie definiert

Deshalb laufen seit dem letzten Deploy **keine Automatisierungen** — die Thermostate werden nicht auf Eco gestellt.

### Fix in `supabase/functions/pv-automation/index.ts`

**1. `ecoRoomsRemaining` definieren** (nach Zeile 981, nach der `ecoRoomDetails`-Berechnung)
```typescript
const ecoRoomsRemaining = ecoRoomDetails.length;
```

**2. `batteryEcoReserveAllowed` definieren** (nach Zeile 990, wo `batteryPower` und `afterSunset` bereits verfügbar sind)
```typescript
const batteryEcoReserveAllowed = afterSunset && ecoRoomsRemaining > 0 && batterySoc > 50;
```

**3. Deploy + Test** — Function deployen und via POST testen dass sie ohne Fehler durchläuft.

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — 2 fehlende Variablen-Deklarationen einfügen

