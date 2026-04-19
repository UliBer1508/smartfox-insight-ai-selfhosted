

## Plan: Tolerante Deaktivierung umsetzen — Tuya-quota-schonend

### Wo der Eingriff sitzt
**Eine** zentrale Stelle in `pv-automation/index.ts` — der Eco-Phase-1-Block (Zeilen 1444-1462) und die nachgelagerte Übersetzung in `action='deactivate'` (Zeile 2224-2236). Kein Eingriff in Sicherheits-Pfade (Übertemperatur, Solar-Limit, Manual Override, Rotation).

### Logik

**Tolerant nur für bereits heizende Räume**, deren Budget knapp wird. Neue Räume bekommen weiterhin den harten Cutoff.

```ts
// In der Phase-1-Eco-Schleife (~Zeile 1444):
if (usedBudget + rp.heatingPower <= availableBudget) {
  // ... wie bisher: allowedToHeat=true
} else {
  // NEU: Tolerante Deaktivierung
  const overshoot = (usedBudget + rp.heatingPower) - availableBudget;
  const isAlreadyHeating = rp.isCurrentlyHeating;
  const forecastSufficient = pvSufficientForEco; // existiert schon
  const trendStable = pvTrend >= -200;          // nicht stark fallend
  const overshootTolerable = overshoot <= Math.max(300, rp.heatingPower * 0.4);
  
  const tolerate = tolerantDeactivationEnabled
    && isAlreadyHeating
    && forecastSufficient
    && trendStable
    && overshootTolerable;
  
  if (tolerate) {
    usedBudget += rp.heatingPower;
    roomBudgetStatus.set(rp.room.id, {
      allowedToHeat: true,
      reason: `Eco-Toleranz (Overshoot ${overshoot}W, Trend ${pvTrend}W, Prognose ok)`,
      shouldRotate: false,
      targetLevel: 'eco'
    });
    console.log(`[TOLERANT-DEACTIVATION] ${rp.room.name}: Heizt weiter trotz Budget-Overshoot ${overshoot}W (Trend ${pvTrend}W ≥ -200, Prognose reicht)`);
  } else {
    // Bisheriges Verhalten: deaktivieren
    roomBudgetStatus.set(rp.room.id, { allowedToHeat: false, ... });
  }
}
```

### Tuya-Quota-Schutz (5 Mechanismen, alle bestehend)

Die bestehende Pipeline schützt bereits stark — die tolerante Deaktivierung **erhöht keine Calls**, sie **reduziert** sie:

1. **`tempAlreadyCorrect`-Gate** (Zeile 2394): Wenn Soll-Temp bereits korrekt → kein Tuya-Call. Bei Toleranz bleibt `target_temp = ecoTemp` → keine Änderung → **kein Call**.
2. **Cooldown-Gate** (Zeile 2354): Heiz-Aktionen unterliegen Cooldown.
3. **`min_room_pause_minutes`** (15 Min): Bei tatsächlicher Deaktivierung greift weiterhin die Pause-Sperre vor erneuter Aktivierung.
4. **120-Min Cloud-Sync** (bestehend, mem://integration/tuya/api-quota-management-v2): Begrenzt redundante Sync-Calls.
5. **Quota-Check** (`quotaExhausted`): Bei erschöpfter Quota werden alle Schreib-Operationen blockiert.

**Zusätzlich neu**: Ein **Tuya-Call-Counter pro Run** im Log:
```ts
console.log(`[TUYA-QUOTA-RUN] ${tuyaCallsThisRun} Tuya-Calls in diesem Run (Tolerant: ${tolerantSavedCalls} eingespart)`);
```
Reine Diagnostik — zeigt empirisch, ob die Toleranz wirkt.

### Erwartetes Verhalten

**Szenario: Bad Uli heizt, Wolke zieht 30 Sek vorbei**
- Vorher: Budget 800W → 600W, Bad Uli (500W) → `allowedToHeat=false` → `action=deactivate` → `target_temp=night_temp` → **Tuya-Call** + 15 Min Pause-Sperre → 2 Min später erneuter Call zum Aktivieren = **2 Tuya-Calls + Komfort-Verlust**
- Nachher (mit Toleranz): Overshoot 200W ≤ 300W, Trend -100W ≥ -200W, Prognose ok → **0 Tuya-Calls**, Raum heizt durch.

**Szenario: PV bricht echt ein (Sonnenuntergang)**
- Trend -800W < -200W → Toleranz greift NICHT → harter Cutoff wie bisher.

### Trade-offs

| Aspekt | Vorher | Nachher |
|---|---|---|
| Tuya-Calls bei wechselhaftem Wetter | Hoch | **Reduziert** (Toleranz statt Switch) |
| Risiko Batterie-Drain | Niedrig | **Niedrig** (Doppel-Gate: Trend + Prognose) |
| Komfort | Schwankend | **Stabiler** |

### Dateien

| Datei | Änderung |
|---|---|
| `supabase/functions/pv-automation/index.ts` | Tolerante Deaktivierung in Phase-1-Loop, Quota-Counter-Logging |
| `mem://arch/pv-automation-budget-logic-v2` | Tolerante Deaktivierung dokumentieren |

### Risiken

- **Stacking mit Mikro-Budget**: Toleranz greift nur in Phase 1 (Eco), Mikro-Budget hat eigene Gates → kein Konflikt.
- **Kettenreaktion**: Falls 3 Räume gleichzeitig overshoot haben → max. Stack = 3 × 300W = 900W über Budget. Mitigation: Toleranz wird sequentiell pro Raum geprüft — erst der nächste Raum sieht den bereits gestackten `usedBudget`, daher selbstbegrenzend.

