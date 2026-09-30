---
name: PV Automation Strategy v2 (Reactive)
description: Reactive heating strategy — wait for real grid export before activating new room. No predictive "effective export" trick.
type: feature
---

## Reactive PV Heating Strategy

**Phase 1 (Eco) before Phase 2 (Comfort)** — strikt sequentiell, Prioritäten 1–12.

### Komfort-Budget (reaktiv)
```
comfortBudget = gridExport − baseloadBuffer + symTrendBonus + lookaheadBonus
              + batteryFullBonus (only if SOC ≥ 95% AND forecast ≥ 10kW)
              − abs(batteryPower) if charging
```

**Wichtig:** `gridExport` ist der **echte Zähler-Export**. Die laufende Heizleistung wird **nicht** mehr dazugerechnet (kein "effective export"-Trick mehr). Stattdessen:

- Raum erreicht Komfort → zurück auf Eco-Setpoint → Estrich speichert
- Frei werdendes Budget wird **nicht im selben Run** umverteilt
- Erst der **nächste Run** (2 Min später) sieht den realen Export am Zähler und aktiviert ggf. den nächsten Raum

### Mindest-Heizdauer / Cooldown
- `DEFAULT_MIN_SWITCH_INTERVAL_MIN = 25` Minuten (vorher 5)
- Verhindert Ping-Pong-Umschaltungen, schont Tuya-Quota
- Gilt nur für Aufheiz-Aktionen; Sicherheits-Stops umgehen Cooldown

### Vorteile
- Massiv weniger Tuya-Calls (~30–50/Tag statt 280+)
- Keine Phantom-Aktivierungen aus Akku/Netz bei Fehlprognose
- Logik ehrlich und einfach zu debuggen

### Nachteil
- 3–5 Min "verlorene" Sonne pro Raumwechsel (Thermostat-Wakeup)
- Bei wechselhaftem Wetter etwas langsamere Reaktion
