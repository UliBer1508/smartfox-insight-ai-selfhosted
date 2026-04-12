

# Fix: Phase 1 (Eco) mit PV-Budget-Prüfung

## Problem

Der vorherige Plan wollte Phase 1 **ohne Budget** machen (Eco als "Pflicht"). Der User möchte aber, dass auch Phase 1 prüft ob genügend PV-Strom/gridExport vorhanden ist. Das aktuelle Verhalten ist also grundsätzlich richtig — Phase 1 verbraucht Budget.

**Was fehlt:** Die PV-Vorhersage soll die Eco-Entscheidung beeinflussen:
- **Gute Prognose** (z.B. > 10 kWh): Alle Räume auf Eco heizen (Budget großzügiger)
- **Wenig PV**: Nur den verfügbaren gridExport-Strom für Eco nutzen, Raum für Raum nach Priorität

## Aktueller Zustand (Zeilen 927-945)

```text
pvPower > 500W → Budget = gridExport + heizendePower + 20% Toleranz
pvPower < 500W → Budget = 0 (KEIN Heizen)
```

Das Problem: Die PV-Vorhersage (`expectedPvKwh`) wird beim Budget **nicht berücksichtigt**. Ein sonniger Tag mit 30 kWh Prognose bekommt dasselbe Budget wie ein bewölkter Tag mit 5 kWh.

## Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

### 1. Budget-Berechnung um PV-Prognose erweitern (Zeilen ~927-945)

Wenn die Tagesprognose hoch ist, wird das Budget für Phase 1 (Eco) erweitert — weil tagsüber genug PV kommen wird, um die Eco-Heizung zu "refinanzieren":

```typescript
if (powerBudgetEnabled) {
  if (pvPower > 500) {
    budgetMode = 'pv_optimized';
    const currentlyHeatingPower = rooms
      .filter(r => r.is_heating)
      .reduce((sum, r) => sum + (r.calculated_power_w || r.heating_power_w || 800), 0);
    const dynamicTolerance = Math.max(powerBudgetTolerance, Math.round(gridExport * 0.20));
    
    // Basis-Budget: gridExport + bereits heizend + Toleranz
    let baseBudget = gridExport + currentlyHeatingPower + dynamicTolerance;
    
    // PV-Prognose-Bonus: Bei guter Vorhersage mehr Budget für Eco
    // > 15 kWh: alle Räume sollen Eco bekommen (großes Budget)
    // > 8 kWh: mittleres Extra-Budget
    // < 8 kWh: nur gridExport nutzen (kein Bonus)
    let forecastBonus = 0;
    if (expectedPvKwh >= 15) {
      forecastBonus = 3000; // Viel PV erwartet → großzügig heizen
    } else if (expectedPvKwh >= 8) {
      forecastBonus = 1500; // Mittlere PV → moderater Bonus
    }
    
    availableBudget = Math.max(0, baseBudget + forecastBonus);
    console.log(`[PV-Automation] PV-Budget: gridExport ${gridExport}W + heizend ${currentlyHeatingPower}W + Toleranz ${dynamicTolerance}W + Prognose-Bonus ${forecastBonus}W (${expectedPvKwh} kWh) = ${availableBudget}W`);
  } else if (gridExport > 200) {
    // Wenig PV-Produktion ABER gridExport vorhanden
    // → gridExport für Eco nutzen (z.B. Batterie speist ins Netz)
    budgetMode = 'grid_sequential';
    availableBudget = Math.max(0, gridExport);
    console.log(`[PV-Automation] Wenig PV (${pvPower}W) aber gridExport ${gridExport}W → Budget für Eco: ${availableBudget}W`);
  } else {
    budgetMode = 'grid_sequential';
    availableBudget = 0;
    console.log(`[PV-Automation] Wenig PV (${pvPower}W) und kein gridExport → KEIN Heizen, Budget=0W`);
  }
}
```

### 2. Phase 1 bleibt Budget-geprüft

Die Phase-1-Logik (Zeilen 1069-1101) bleibt **unverändert** — sie nutzt weiterhin das `availableBudget` und verteilt Eco nach Priorität. Der Unterschied ist nur, dass das Budget jetzt durch die PV-Prognose beeinflusst wird.

### 3. Phase 2 Komfort-Upgrade bleibt

Die Phase 2 (Zeilen 1103-1157) bleibt ebenfalls unverändert — Eco-Räume können auf Komfort upgraded werden wenn Restbudget vorhanden ist.

## Ergebnis

```text
Sonniger Tag (30 kWh, gridExport 1800W):
  Budget = 1800 + 0 + 360 + 3000 = 5160W
  Phase 1: ALLE Räume → Eco ✅ (genug Budget)
  Phase 2: Nach Priorität → Komfort

Bewölkter Tag (5 kWh, gridExport 400W):
  Budget = 400 + 0 + 200 + 0 = 600W
  Phase 1: Bad Uli (600W) → Eco ✅, Rest kein Budget
  Phase 2: kein Restbudget

Kein PV aber gridExport 300W:
  Budget = 300W
  Phase 1: Kleiner Raum → Eco ✅
```

## Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen ~927-945 (Budget-Berechnung)

