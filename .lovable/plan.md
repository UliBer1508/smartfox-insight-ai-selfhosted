

## Problem

Wenn PV-Strom vorhanden ist aber nicht ausreicht, wird die Batterie entladen um die Heizung zu versorgen. Die Budget-Berechnung addiert `gridExport + bereits heizende Leistung`, berücksichtigt aber nicht, dass ein Teil dieser Heizleistung aus der Batterie kommt.

**Beispiel aktuell:**
```text
PV: 1450W, Grundlast: 238W, Heizung: 1300W
→ Batterie entlädt 1129W um die Lücke zu füllen
→ Budget rechnet: 0W Export + 1300W heizend = 1300W ✓
→ Aber nur ~1155W davon kommen wirklich von PV!
```

## Lösung

Die Batterie-Entladung vom Budget abziehen. Wenn `battery_power` negativ ist (Entladung), wird das Budget entsprechend reduziert.

### Änderung in `supabase/functions/pv-automation/index.ts`

**Zeile ~921:** `battery_power` aus dem Reading auslesen:
```typescript
const batteryPower = reading.battery_power || 0; // positiv=laden, negativ=entladen
```

**Zeile ~957:** Budget-Berechnung anpassen:
```typescript
let baseBudget = gridExport + currentlyHeatingPower + dynamicTolerance;

// Batterie-Schutz: Wenn Batterie entlädt, ist das Budget zu hoch geschätzt
// Batterie-Entladung bedeutet: PV reicht nicht für alles
if (batteryPower < 0) {
  const batteryDrain = Math.abs(batteryPower);
  baseBudget = Math.max(0, baseBudget - batteryDrain);
  console.log(`[PV-Automation] ⚡ Batterie-Korrektur: ${batteryDrain}W Entladung → Budget reduziert auf ${baseBudget}W`);
}
```

**Komfort-Budget ebenfalls korrigieren (~Zeile 967):**
```typescript
let rawComfortBudget = gridExport + currentlyHeatingPower;
if (batteryPower < 0) {
  rawComfortBudget = Math.max(0, rawComfortBudget - Math.abs(batteryPower));
}
comfortBudget = Math.max(0, rawComfortBudget);
```

### Erwartetes Ergebnis

```text
Vorher:  Budget = 0 + 1300 + 200 = 1500W → 2 Räume heizen, Batterie entlädt
Nachher: Budget = 0 + 1300 + 200 - 1129 = 371W → nur 1 kleiner Raum oder keiner
→ Batterie wird nicht mehr für Heizung entladen
→ Heizung nutzt nur was PV tatsächlich liefert
```

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Budget-Berechnung (~Zeile 940-968)

