---
name: PV-Automation Strategy v2
description: Strikt sequentielle 2-Phasen-Strategie — Phase 2 (Komfort) startet erst wenn Phase 1 (Eco) für ALLE Räume abgeschlossen ist
type: feature
---

Die `pv-automation` folgt einer **strikt sequentiellen** 2-Phasen-Strategie:

**Phase 1 (Eco-Runde):** Alle Räume unter `eco_temp − 0.3` werden nach Priorität (1→12) auf `eco_temp` hochgeheizt, solange das `availableBudget` (gridExport + heizende Räume + Toleranz + ggf. Prognose-/Trend-/Batterie-Bonus) reicht.

**Phase-1-Gate (`phase1Complete`):** Nach Phase 1 wird geprüft ob jeder Raum entweder
- bereits `≥ eco_temp − 0.3` ist, ODER
- in Phase 1 aktiviert wurde (`targetLevel === 'eco'` mit Budget), ODER
- durch Pause/Rotation/Override blockiert ist.

Wenn auch nur **ein** Raum Eco anstrebt aber kein Budget bekommen hat → `phase1Complete = false`.

**Phase 2 (Komfort-Runde):** Läuft **NUR** wenn `phase1Complete === true`. Räume mit `eco_temp ≤ current_temp < comfort_temp − 0.3` werden nach Priorität auf Komfort upgegradet, solange `comfortBudget` (= `effectiveExport` = `gridExport + currentlyHeatingPower − baseload + trend + lookahead + batteryFullBonus`) reicht.

**Wenn Phase 2 übersprungen wird:** Räume die bereits ≥ comfort waren behalten ihren Komfort-Status (kein Downgrade), Räume in Eco-Bereich bleiben auf `targetLevel = 'eco'`. Beim nächsten 2-min-Heartbeat wird neu evaluiert — sobald der letzte Eco-Raum aufgeholt hat, schaltet Phase 2 in einem Tick alle berechtigten Räume auf Komfort hoch.

**Begründung der sequentiellen Strategie:** Wenn der gesamte Überschuss zuerst in Eco-Aufheizung fließt, erreichen alle Räume Eco messbar schneller, weil keine Komfort-Räume das Budget abziehen. Erst dann wird gemeinsam auf Komfort hochgefahren. Verhindert dass bevorzugte Räume (Prio 1) auf Komfort heizen während andere (Prio 5) noch frieren.

**Komfort-Budget-Quellen (strikt):** Nur `effectiveExport` zählt als Komfort-Budget. Niemals Batterie-Reserve oder Prognose-Bonus. Komfort wird zusätzlich durch das Komfort-Hard-Lock geschützt: Bei `batterySoc < heating_min_battery_soc` (default 80%) → `comfortBudget = 0`. Battery-Full Bonus aktiv wenn SOC ≥ 95% und PV-Prognose ≥ 10 kW.

**UI-Plan-Vorausberechnung:** `system_settings.parallel_heating_capacity.max_parallel_comfort` wird nur dann > 0 gesetzt, wenn ALLE Eco-Kandidaten ins Eco-Budget passen. Sonst zeigt das UI nicht irreführend „Komfort möglich" an, während Phase 2 gerade gegated ist.

**Manual Override:** `manual_override_until` wird strikt gegen `now()` (UTC, da `timestamptz`) verglichen. Abgelaufene Overrides werden ignoriert.
