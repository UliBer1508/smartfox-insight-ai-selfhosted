---
name: Parallel Heating Allocation (Budget-basiert)
description: Multi-Raum parallele Aktivierung — Budget = gridExport + currentlyHeatingPower + Boni. Sortierung nach Priorität 1→12. 1 Tuya-Call pro Aktivierung, kein Polling, Nachschub via 2-min Heartbeat.
type: feature
---

## Strategie

Phase 1 (Eco) verteilt das verfügbare PV-Budget auf Räume nach strikter Priorität (1→12, dann Defizit, dann Effizienz). Mehrere Räume können parallel aktiviert werden, solange das Budget reicht.

## Budget-Berechnung

```
availableBudget = gridExport
                + currentlyHeatingPower   // bereits heizende Räume zurückrechnen
                + dynamicTolerance         // ~20% von gridExport
                + prognoseBonus            // bis +1500W bei guter PV-Prognose
                + batteryBuffer            // bis +500W bei SOC weit über Reserve
                + trendBonus               // ±1500W (Trend × 0.5)
                − batteryReserve           // wenn SOC < heating_min_battery_soc
                − hotwaterReserve − carReserve
```

Wichtig: `currentlyHeatingPower` ist additiv im Budget — Räume die schon heizen "verdrängen" keine neuen Räume.

## Aktivierungs-Loop (sequenziell pro Raum, nach Prio sortiert)

1. **Bereits korrekt** (`shouldSkip`): `tempAlreadyCorrect && stateAlreadyCorrect` → **kein Tuya-Call**, nur Log `SKIP - already at X°C`.
2. **Budget passt**: `usedBudget + roomPower <= availableBudget` → 1 Tuya-Call (`set_target_temp`), `usedBudget += roomPower`, Log `[ACTIVATE]`.
3. **Budget zu klein**: Log `[QUEUE] wartet auf Budget` — kein Call, wird beim nächsten 2-min Heartbeat erneut geprüft.
4. **Hysterese-Block**: Export < `pv_surplus_threshold_on` → kein Start.

## Nachschub-Mechanik

`pg_cron` triggert `pv-automation` alle 2 Minuten. Sobald ein Raum fertig ist (Hysterese-Off greift) oder mehr Sonne kommt, wird beim nächsten Tick automatisch der nächste wartende Raum aktiviert. Kein Sondertimer nötig.

## Garantien

- **Genau 1 Tuya-Call pro echter Setpoint-Änderung pro Raum**
- **0 Calls für Status-Checks** — Raum-State kommt aus DB (vom Local Collector synchronisiert)
- **0 Calls für bereits korrekte Räume** (`shouldSkip`)
- **Deaktivierungen** (Hysterese-Off, Komfort erreicht, Override) sind uncapped — Sicherheit hat Vorrang
