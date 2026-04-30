## Problem

Räume mit Ist-Temperatur ≥ Eco werden nicht auf Komfort hochgestuft, obwohl reichlich PV verfügbar ist:

- Batterie **95.6 %** (voll), PV-Prognose nächste Stunde **23.326 W**
- Aber `comfortBudget = 0 W` weil `gridExport = 0 W` (aktuell heizt Wirtschaftsraum mit 700 W → frisst potenziellen Export)
- Header zeigt korrekt **„+3 Eco möglich"**, aber das System bleibt bei Eco

Aus den Logs:
```
PARALLEL-PLAN: Export 0W, Puffer 200W, Trend +120W → Komfort-Budget 0W (0/3 Räume parallel)
Wohnzimmer (22.6°C): Eco halten (kein Komfort-Budget: 0+2400>17366W)
Zimmer Luca (20.9°C): Eco halten (kein Komfort-Budget: 0+1000>17366W)
```

Henne-Ei-Problem: Aktives Heizen verbraucht Export → Budget 0 → kein Upgrade möglich → Strom geht ungenutzt verloren.

## Lösung: Battery-Full Komfort-Bonus

In `supabase/functions/pv-automation/index.ts` (Komfort-Budget-Berechnung in `calculateParallelHeatingCapacity` bzw. dort wo `comfort_budget_w` ermittelt wird):

**Neue Regel** — wenn ALLE folgenden Bedingungen erfüllt sind:
1. `batterySoc ≥ 95 %` (Batterie quasi voll)
2. `pvForecastNextHour ≥ 10 kW` (verlässlich Überschuss kommt)
3. Tagmodus (nicht Nacht)

→ Dann gilt:
```ts
const batteryFullBonus = Math.max(0, pvForecastNextHour - currentConsumption - 2000);
comfortBudget = gridExport - baseloadBuffer + trendBonus + lookahead + batteryFullBonus;
```

Begründung: Bei voller Batterie wird jedes überschüssige Watt eingespeist (oder via Wechselrichter abgeregelt). Es ist energetisch sinnvoll, stattdessen die Räume auf Komfort zu bringen.

## Zusätzliche Korrekturen

**A. Aktiv-heizende Räume nicht doppelt zählen**
Beim Berechnen von `gridExport` für die Komfort-Phase soll die aktuelle Heizleistung der bereits aktiv heizenden Räume rückgerechnet werden:
```ts
const effectiveExport = gridExport + currentlyHeatingPower;
```
Damit verhindern wir, dass das laufende Heizen das eigene Komfort-Budget blockiert.

**B. Logging erweitern**
Im PARALLEL-PLAN-Log auch `batteryFullBonus` und `effectiveExport` ausgeben, damit künftige Diagnosen sofort sichtbar machen, warum Komfort freigegeben wurde.

## Erwartetes Ergebnis

Mit Batterie 95.6 % und Prognose 23.3 kW:
- `batteryFullBonus ≈ 23300 − 1500 − 2000 ≈ 19.800 W`
- `comfortBudget ≈ 0 − 200 + 120 + 0 + 19800 ≈ 19.720 W`
- `max_parallel_comfort` steigt von 0 auf 3
- Wohnzimmer / Zimmer Uli / Luca / Büro / Flur bekommen `target_temp = comfort_temp` (22°C bzw. 21°C)
- Header-Hinweis „+3 Eco möglich" wird umgesetzt

## Memory Update

`mem://arch/pv-automation-budget-logic-v2` ergänzen:
> **Battery-Full Comfort Bonus:** Bei `batterySoc ≥ 95%` und `pvForecastNextHour ≥ 10kW` wird Komfort-Budget um `(forecast − consumption − 2000W)` erhöht, damit Überschuss-PV in Komfort statt Einspeisung fließt. Verhindert Henne-Ei-Blockade durch laufende Heizungen.

## Files

- `supabase/functions/pv-automation/index.ts` — Budget-Berechnung erweitern, Logging
- `mem://arch/pv-automation-budget-logic-v2` — Regel dokumentieren
