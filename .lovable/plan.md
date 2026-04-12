

# Fix: Phase-2-Komfort-Upgrade für Räume die in Phase 1 Eco bekamen

## Problem (eine Zeile)

Zeile 1111 in der Phase-2-Schleife:
```typescript
if (existing.targetLevel !== 'none' || !existing.allowedToHeat) continue;
```
Das überspringt **alle** Räume mit `targetLevel === 'eco'` — also genau die Räume aus Phase 1, die als nächstes auf Komfort upgraded werden sollten.

**Beispiel Bad Uli:**
- Phase 1: Bad Uli → Eco (600W Budget verbraucht) ✅
- Phase 2: `targetLevel === 'eco'` → `'eco' !== 'none'` → **skip** ❌
- Bad Uli bleibt auf Eco, obwohl Budget für Komfort da wäre

## Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**, Zeilen ~1107-1112

Phase 2 muss Räume mit `targetLevel === 'eco'` zulassen und auf Komfort upgraden. Da diese Räume bereits Budget verbrauchen (heizen ja schon), ist **kein zusätzliches Budget** nötig — der Thermostat wird nur höher gestellt.

```typescript
// Vorher (Zeile 1107-1112):
if (roomBudgetStatus.has(rp.room.id)) {
  const existing = roomBudgetStatus.get(rp.room.id)!;
  if (existing.targetLevel !== 'none' || !existing.allowedToHeat) continue;
}

// Nachher:
if (roomBudgetStatus.has(rp.room.id)) {
  const existing = roomBudgetStatus.get(rp.room.id)!;
  // Räume auf Eco dürfen auf Komfort upgraded werden (kein Extra-Budget nötig)
  if (existing.targetLevel === 'eco' && existing.allowedToHeat) {
    // Weiter zur Komfort-Prüfung — Budget bereits allokiert
  } else if (existing.targetLevel !== 'none' || !existing.allowedToHeat) {
    continue;
  }
}
```

Zusätzlich in der Komfort-Budget-Prüfung (Zeile ~1120): Wenn der Raum bereits aus Phase 1 Budget hat, **kein erneutes `usedBudget += heatingPower`**:

```typescript
const alreadyBudgeted = roomBudgetStatus.has(rp.room.id) && 
  roomBudgetStatus.get(rp.room.id)!.targetLevel === 'eco';

if (alreadyBudgeted || usedBudget + rp.heatingPower <= availableBudget) {
  if (!alreadyBudgeted) usedBudget += rp.heatingPower;
  roomBudgetStatus.set(rp.room.id, {
    allowedToHeat: true,
    reason: `Komfort-Phase (${usedBudget}/${availableBudget}W)`,
    shouldRotate: false,
    targetLevel: 'comfort'
  });
}
```

## Ergebnis bei ~1800W Budget

```text
Phase 1 (Eco):
  Bad Uli (600W) → Eco      [600/1800W]
  Zimmer Uli (1200W) → Eco  [1800/1800W]
  Büro → kein Budget

Phase 2 (Komfort):
  Bad Uli → Komfort ✅ (bereits budgetiert, kein Extra)
  Zimmer Uli → Komfort ✅ (bereits budgetiert, kein Extra)
  Büro → kein Budget
```

## Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen ~1107-1135

