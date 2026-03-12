

# Bug: Räume werden auf Komforttemperatur gesetzt trotz fehlendem PV

## Problem

Im Budget-Override (Zeile 1155-1177) wird **nicht** zwischen `pv_optimized` und `grid_sequential` unterschieden. Die Logik sagt:

- Raum kälter als eco_temp → `targetTemp = ecoTemp` ✅
- Raum **bei oder über** eco_temp → `targetTemp = comfortTemp` ❌

Das passiert auch im `grid_sequential`-Modus (kein PV), wo Räume **nur** auf `eco_temp` geheizt werden dürfen. Deshalb stehen alle Räume, die eco_temp erreicht haben, auf 20-21°C Komfort statt dort zu stoppen.

## Lösung

In `supabase/functions/pv-automation/index.ts`, Zeile 1155-1177:

**Budget-Override nach `budgetMode` differenzieren:**

- `grid_sequential` (kein PV): Nur bis `eco_temp` heizen. Wenn Raum bereits bei eco_temp → `action = 'keep'`, **nicht** auf comfort hochsetzen.
- `pv_optimized` (PV vorhanden): Wie bisher — erst eco, dann comfort bei genug Überschuss.

```text
if (budgetStatus.allowedToHeat) {
  if (budgetMode === 'grid_sequential') {
    // KEIN PV: Nur bis eco_temp, dann stoppen
    if (currentRoomTemp < ecoTemp - 0.3) {
      action = 'activate';
      targetTemp = ecoTemp;
      reasoning = `🔌 Grid-Heizen: ${ecoTemp}°C (...)`;
    } else {
      // Eco erreicht → nicht weiter heizen
      action = 'keep';
      targetTemp = ecoTemp;
      reasoning = `✅ Eco erreicht (${currentRoomTemp}°C ≥ ${ecoTemp}°C)`;
    }
  } else {
    // PV-OPTIMIERT: eco zuerst, dann comfort
    ... (bestehende Logik)
  }
}
```

## Dateien

- `supabase/functions/pv-automation/index.ts` — Budget-Override-Abschnitt (Zeile 1155-1177)

## Erwartetes Ergebnis

- Ohne PV: Räume stoppen bei eco_temp (18-19°C), werden nicht auf 20-22°C hochgeheizt
- Mit PV: Verhalten bleibt gleich (eco → comfort bei Überschuss)

