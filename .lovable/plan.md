

# Fix: Budget-Vergabe muss Priorität in einer Runde respektieren

## Problem

Das Budget-System hat zwei getrennte Runden (Zeilen 780-852):
1. **Runde 1**: Alle bereits heizenden Räume behalten ihr Budget -- egal welche Priorität
2. **Runde 2**: Nicht-heizende Räume bekommen den Rest

Ergebnis: Waschraum (Prio 7, 600W), Flur (Prio 7, 700W), Wirtschaftsraum (Prio 7, 700W) belegen zusammen 2000W Budget, weil sie gerade heizen. Wohnzimmer (Prio 6, 2400W) bekommt kein Budget mehr.

## Lösung

Die zwei Runden zu **einer einzigen Runde** in Prioritäts-Reihenfolge zusammenfassen. Für jeden Raum in Reihenfolge:
- Wenn er heizt UND Budget reicht → weiter heizen (Rotation prüfen)
- Wenn er NICHT heizt UND Budget reicht → aktivieren (Pause prüfen)
- Wenn Budget nicht reicht → stoppen (auch wenn er gerade heizt!)

So wird ein Prio-7-Raum gestoppt, wenn sein Budget für einen höher-priorisierten Raum gebraucht wird.

## Beispiel mit 6425W Export (Budget ~7710W)

**Vorher** (zwei Runden):
```text
Runde 1: Bad Uli(600) + Z.Uli(1200) + Z.Luis(1000) + Büro(900) + Waschraum(600) + Flur(700) + Wirtschaftsraum(700) = 5700W
Runde 2: Z.Luca(1000)=6700 ✓, Toilette(800)=7500 ✓, Wohnzimmer(2400)=9900 ✗
```

**Nachher** (eine Runde nach Priorität):
```text
Bad Uli(600) + Z.Uli(1200) + Z.Luis(1000) + Z.Luca(1000) + Büro(900) + Wohnzimmer(2400) = 7100W ✓
Waschraum(600) = 7700W ✓, Flur(700) = 8400W ✗ → gestoppt
```

## Technische Änderung

**Datei:** `supabase/functions/pv-automation/index.ts` (Zeilen 780-853)

Die zwei `for`-Schleifen (Runde 1: heizende Räume, Runde 2: nicht-heizende Räume) durch eine einzige Schleife ersetzen, die in Prioritäts-Reihenfolge iteriert:

```typescript
for (const rp of roomsWithPriority) {
  // Rotation prüfen (nur für heizende Räume)
  if (rp.isCurrentlyHeating) {
    const shouldRotate = /* bestehende Rotationslogik */;
    if (shouldRotate) {
      roomBudgetStatus.set(rp.room.id, { allowedToHeat: false, reason: '...', shouldRotate: true });
      continue;
    }
  }
  
  // Pause prüfen (nur für nicht-heizende Räume)
  if (!rp.isCurrentlyHeating && rp.waitTimeMinutes < minRoomPauseMinutes && rp.room.last_heating_end) {
    roomBudgetStatus.set(rp.room.id, { allowedToHeat: false, reason: '...', shouldRotate: false });
    continue;
  }
  
  // Budget-Check (für alle)
  if (usedBudget + rp.heatingPower <= availableBudget) {
    usedBudget += rp.heatingPower;
    const status = rp.isCurrentlyHeating ? 'Weiter heizen' : 'Aktiviert';
    roomBudgetStatus.set(rp.room.id, { allowedToHeat: true, reason: `${status} (${usedBudget}/${availableBudget}W)`, shouldRotate: false });
  } else {
    roomBudgetStatus.set(rp.room.id, { allowedToHeat: false, reason: `Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W`, shouldRotate: false });
  }
}
```

Keine weiteren Dateien betroffen. Die 4-Stufen-Logik und die Raum-Prioritäten bleiben unverändert.

