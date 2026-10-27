---
name: Tagesmodus und Mindesttemperatur ohne PV
description: Räume ohne Budget bekommen tagsüber ihr Ziel aus dem Tagesmodus (battery_gate / wait / grid) statt pauschal Eco; Netzheizen nach Priorität bis max_grid_heating_power_w
type: constraint
---

**Grundkonzept:** `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md` (freigegeben von Uli am 27.10.2026).

**Regel:** In `pv-automation` bekommt jeder Raum, der in Phase 1/2 **kein echtes Budget** hat (`roomBudgetStatus.budgeted !== true`), tagsüber das Ziel aus `allocateDayTargets`:

| Modus | Bedingung | Ziel |
|---|---|---|
| `battery_gate` | Batterie-Gate aktiv (strict) | `wait_min_temp` |
| `wait` | PV-Rest / Eco-Bedarf ≥ Schwelle (1,0 ± KI) | `wait_min_temp` |
| `grid` | sonst, nach Sonnenuntergang immer | Eco nach Priorität, Summe Raumleistungen ≤ `max_grid_heating_power_w` |

- Räume unter `wait_min_temp` werden in jedem Modus zuerst bis dorthin geheizt (Priorität, Netzgrenze).
- `budgeted: true` setzen nur: Phase-1-Aktivierung, Tolerante Deaktivierung, Mikro-Budget, Phase-2-Komfort.
- KI: `best_match_today` × `pattern_recall_strength` verschiebt die Schwelle um max. ±0,3 (Grenzen 0,5–1,5).
- Protokoll: `system_settings.heating_day_mode`; Anzeige in der Übersicht.

**Nicht wieder einführen:**
- „Tag → eco_temp halten“ für Räume ohne Budget (heizte jeden Morgen alle Räume aus Batterie/Netz).
- Sprung „Eco=Nacht → direkt Komfort“ (umging das Komfort-Budget).
- Komfort-Upgrade allein wegen `targetLevel === 'eco'` ohne `budgeted`.
- Separates `set_mode` im Lokal-Modus (v1.3 setzt Modus „home“ beim Sollwert).

**Why:** Bis 23.10.2026 standen die Thermostate auf „auto“ und ignorierten die Sollwerte. Seit v1.3 („home“) wirkt die Logik; am 27.10. 08:00 starteten dadurch alle 12 Räume (9,6 kW), Batterie 57 → 5 % in 80 Min.
