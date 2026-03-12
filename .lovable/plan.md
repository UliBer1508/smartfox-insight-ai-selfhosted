

# Fix: PV-Boost soll nur bei echter PV-Leistung aktivieren

## Problem

Zeile 1207: `hasEnoughSurplus = gridExport > 500 || batterySoc > 70`

Der `||`-Operator erlaubt den Boost allein durch hohe Batterie-SOC — auch nachts oder bei Bewölkung ohne jede PV-Produktion. Dadurch wird z.B. Kinder Bad auf 20°C (comfort) geheizt, obwohl kein Solarstrom vorhanden ist.

Zusätzlich: `boostAllowed` (Zeile 630) prüft `availableHeatingKwh > 3`, was aus der **Prognose** kommt — nicht aus der aktuellen PV-Leistung. An einem bewölkten Tag kann die Prognose noch 3+ kWh zeigen, obwohl real 0W produziert wird.

## Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

1. **Zeile 1207** — `hasEnoughSurplus` verschärfen:
   - Batterie-SOC entfernen als alleinigen Trigger
   - Bedingung: `gridExport > 500` (echter Netzexport = echter PV-Überschuss)
   - Oder: `pvPower > 1000 && batterySoc > 80` (PV produziert UND Batterie fast voll)

2. **Zeile 1199** — Zusätzliche PV-Guard:
   - `pvPower > 500` als harte Mindestbedingung für Boost
   - Kein PV = kein Boost, unabhängig von Batterie/Prognose

```typescript
// Zeile 1199: PV-Mindestleistung als Voraussetzung
if (boostAllowed && room.automation_enabled && !isNight && pvPower > 500) {

// Zeile 1207: Nur echter Überschuss, nicht Batterie allein  
const hasEnoughSurplus = gridExport > 500 || (pvPower > 1000 && batterySoc > 80);
```

## Ergebnis
- Ohne PV-Leistung: Räume bleiben auf eco_temp, Boost ist komplett blockiert
- Mit PV aber ohne Export: Boost nur wenn PV > 1kW UND Batterie > 80%
- Mit PV-Export > 500W: Boost wie bisher

