---
name: PV-Automation Strategy v2
description: 2-Phasen-Strategie Eco/Komfort, parallele Ausführung statt Eco-Gate für Komfort-Upgrade
type: feature
---

Die `pv-automation` folgt einer 2-Phasen-Strategie für Heizentscheidungen:

**Phase 1 (Eco-Runde):** Alle Räume unter `eco_temp` werden nach Priorität auf `eco_temp` hochgeheizt, solange das `availableBudget` (gridExport + heizende Räume + Toleranz + ggf. Prognose-/Trend-/Batterie-Bonus) reicht.

**Phase 2 (Komfort-Runde) — Parallel statt sequentiell (v2.1):** Phase 2 läuft jetzt IMMER, nicht erst wenn ALLE Räume Eco erreicht haben. Räume die bereits `>= eco_temp - 0.3` sind, dürfen sofort auf `comfort_temp` upgegradet werden, sofern echtes `comfortBudget` (= `gridExport`, KEIN Prognose-/Trend-/Batterie-Bonus) reicht. Räume unter Eco bleiben in Phase 1.

**Begründung der Änderung:** Die alte Strategie blockierte ALLE Komfort-Upgrades, sobald auch nur ein Raum noch unter Eco war. Bei großem Überschuss (z.B. 9 kW) führte das dazu, dass Räume die längst Eco erreicht hatten, nicht auf Komfort hochgingen — der Überschuss wurde stattdessen unnötig eingespeist.

**Komfort-Budget-Quellen (strikt):** Nur `gridExport` zählt als Komfort-Budget. Niemals Batterie-Reserve, Prognose-Bonus, Trend-Bonus oder Puffer. Komfort wird zusätzlich durch das Komfort-Hard-Lock geschützt: Bei `batterySoc < heating_min_battery_soc` (default 80%) → `comfortBudget = 0`.

**Logging:** Pro Raum wird im 2-Phasen-Check `comfortBudget`, `usedComfortBudget`, `ecoBudget`, `usedEcoBudget` und `roomPower` geloggt. So ist eine Fehl-Allokation sofort erkennbar.

**Manual Override:** `manual_override_until` wird strikt gegen `now()` (UTC, da `timestamptz`) verglichen. Abgelaufene Overrides werden ignoriert.
