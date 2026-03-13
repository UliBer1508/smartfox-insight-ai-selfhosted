

# Fix: Nur PV-Strom zum Heizen, Komfort als Maximum, sequenziell

## Probleme identifiziert

Drei Stellen in `supabase/functions/pv-automation/index.ts` verursachen Netzstromverbrauch und Überheizung:

### 1. PV-Boost heizt ÜBER comfort_temp (Zeile 1226-1254)
`boostMaxTemp = comfortTemp + boostDelta` (z.B. 21 + 2 = 23°C). Das ist zu viel und zieht Netzstrom.

### 2. Grid-Sequential heizt mit Netzstrom (Zeile 688-693)
Wenn PV < 500W, wird `grid_sequential` aktiviert mit Budget = 2000W aus dem Netz. Das soll nicht sein — ohne PV soll NICHT geheizt werden.

### 3. PV-Optimized setzt comfort_temp obwohl PV nicht reicht (Zeile 1201-1211)
Im `pv_optimized`-Modus wird ein Raum auf `comfortTemp` gesetzt, auch wenn das verfügbare PV-Budget dafür nicht ausreicht. Die Differenz kommt vom Netz.

### 4. ML-Entscheidungen nicht gedeckelt (Zeile 1087-1088)
ML/KI kann beliebige Zieltemperaturen setzen, auch über comfort.

### 5. Fallback-Logik heizt ohne PV (Zeile 1120-1126)
Tagsüber-Default setzt eco_temp auch ohne PV-Überschuss.

## Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

### A. Grid-Sequential komplett entfernen (Zeile 688-693)
Wenn pvPower < 500W → **kein Heizen**, statt Grid-Fallback. Alle Räume bleiben auf night_temp/aktuellem Wert.

```typescript
if (pvPower > 500) {
  budgetMode = 'pv_optimized';
  availableBudget = Math.max(0, pvPower - baseLoad + powerBudgetTolerance);
} else {
  // KEIN PV → kein Heizen, Budget bleibt 0
  budgetMode = 'grid_sequential'; // wird als "kein Heizen" behandelt
  availableBudget = 0; // ← von maxGridHeatingPower auf 0
}
```

### B. PV-Boost auf comfort_temp deckeln (Zeile 1226-1254)
`boostMaxTemp` darf nie über `comfortTemp` (raumspezifisch) liegen. Effektiv: Boost deaktiviert, da comfort = Maximum.

### C. PV-Optimized: nur eco_temp, nicht comfort (Zeile 1201-1211)
Im `pv_optimized`-Modus maximal `ecoTemp` setzen. `comfortTemp` nur wenn gridExport > 500W (echter Überschuss der nicht gebraucht wird).

```typescript
// PV-OPTIMIERT: eco_temp als Standard, comfort nur bei echtem Export
action = 'activate';
if (currentRoomTemp < ecoTemp - 0.5) {
  targetTemp = ecoTemp;
} else if (gridExport > 500) {
  // Echter Überschuss → comfort erlaubt
  targetTemp = comfortTemp;
} else {
  // Eco erreicht, kein Export → halten
  action = 'keep';
  targetTemp = ecoTemp;
}
```

### D. ML-Entscheidungen auf comfort_temp deckeln (nach Zeile 1088)
```typescript
targetTemp = Math.min(mlDecision.target_temp, comfortTemp);
```

### E. Fallback-Logik: kein Heizen ohne PV (Zeile 1097, 1120-1126)
Die Fallback-Aktivierung (Zeile 1120-1126) nur erlauben wenn PV > 500W.

## Erwartetes Ergebnis
- Ohne PV: Kein Heizen, 0W Netzverbrauch für Heizung
- Mit PV: Sequenziell ein Raum nach dem anderen, max eco_temp
- Bei PV-Export > 500W: Aufheizen bis comfort_temp erlaubt
- comfort_temp ist absolutes Maximum, kein Boost darüber

