---
name: SOC-Schwellwerte konsolidiert
description: Nur heating_min_battery_soc ist wirksam; min_battery_soc und target_battery_soc sind deprecated DB-Reste ohne UI/Logik
type: feature
---

Für die PV-/Heizungs-Automatik gibt es nur noch **einen** wirksamen Batterie-SOC-Schwellwert:

- **`heating_min_battery_soc`** (default 80%) — steuert das gehärtete SOC-Gate (`pv-automation-budget-logic-v2`). Komfort-Hard-Lock + erweiterte Gate-Bedingung + aktive Notfall-Stops.

**Deprecated (UI entfernt, Logik entfernt, DB-Spalten bleiben):**
- `heating_settings.min_battery_soc` — UI-Felder entfernt, tote Variable in `pv-automation` entfernt, aus AI-Prompts (`analyze-patterns`, `generate-settings-suggestions`) entfernt.
- `heating_settings.target_battery_soc` — analog. Frühere Aussage „target_battery_soc = 40% wirksam" gilt nicht mehr.

Spalten bleiben in der DB (Defaults 20/80) zur Vermeidung einer Migration. Das ML/AI darf diese Keys nicht mehr vorschlagen (Whitelist & Tool-Schema bereinigt).

Nicht zu verwechseln mit:
- `micro_budget_min_battery_soc` (default 80%) — eigener Schwellwert für Mikro-Budget-Modus.
- `battery_reserve_for_night_soc` (default 60%) — Reserve für Nachverbrauch.
