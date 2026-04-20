---
name: PV-Automation Budget Logic v2
description: Eco vs Komfort-Budget, Mikro-Budget, Prognose-Bonus, Batterie-Reserve, PV-Trend, gehärtetes SOC-Gate mit aktiven Notfall-Stops
type: feature
---

Das Heizbudget der `pv-automation` arbeitet mit zwei separaten Budgets und mehreren Boost-Mechanismen:

**Eco-Budget** (`availableBudget`):
- Basis: `gridExport + currentlyHeatingPower + dynamicTolerance`
- Batterie-Korrekturen: bei Entladung Reduktion, bei niedrigem SOC (<80%) Ladereserve abziehen
- **Prognose-Mindest-Budget** (nur Eco, ab 9 Uhr) und **Prognose-Bonus** (gestuft) — beide nur aktiv wenn `batterySoc ≥ heatingMinSoc` UND `power_io ≤ +50W` (Hard-Gate `[OVERSHOOT-GATE]`).
- **Batterie-Puffer** (`battery_buffer_enabled`) und **PV-Trend Bonus** wie bisher.

**Komfort-Budget** (`comfortBudget`): IMMER strikt — nur echter `gridExport`, niemals Batterie, niemals Prognose-/Trend-/Reserve-Bonus.

**SOC-GATE (gehärtet, v3)** — schützt definierten Schwellwert `heating_min_battery_soc` (default 80%):

1. **Komfort-Hard-Lock (immer aktiv):** Sobald `batterySoc < heatingMinSoc` → `comfortBudget = 0`, unabhängig davon ob die Batterie gerade lädt oder entlädt. Verhindert dass Komfort-Targets vormittags „durchlaufen", wenn der SOC später fällt.

2. **Erweiterte Gate-Bedingung:** `socGateBlocked = batterySoc < heatingMinSoc && (batteryPower ≤ 50 || power_io > 50)`.
   - Greift auch bei `batteryPower ≈ 0` (idle/leere Batterie) — schließt den früheren Bug, bei dem `batteryPower = 0` als „lädt" interpretiert wurde.
   - Greift auch bei Netzbezug (`power_io > 50`) selbst wenn die Batterie kurz +1W „Laden" misst (Mess-Jitter).
   - 50W-Toleranz für saubere Lade-Erkennung.

3. **Modi:**
   - `strict` (default): `availableBudget = 0`, `comfortBudget = 0` UND aktive Notfall-Stops.
   - `soft`: nur `comfortBudget = 0`, Eco bleibt für laufende Räume nutzbar.

4. **Aktive Notfall-Stops `[SOC-GATE-STOP]` (strict):** Da TGP508-Thermostate ihre Sollwerte autonom halten, reicht Budget=0 nicht. Bei Gate-Aktivierung iteriert die Function alle automatisierten Räume und schreibt für alle Räume mit `target_temp > night_temp` oder `is_heating === true` (außer bei aktivem manual_override) je einen `set_temperature`-Befehl mit `value = night_temp` in `thermostat_commands`. Der lokale Service (oder tuya-control) führt diese Befehle aus — unabhängig von der Tuya-Cloud-Quota. `heating_paused_reason` wird gesetzt (`SOC-Gate (X% < 80%)`).

**Critical-Eco-Transition Fix (v3):** Der Quota-Override für die Eco-Transition feuert jetzt nur noch im Morgenfenster `wienHour === 9 && wienMinute < 30` (statt `wienHour >= 9`). Verhindert das fälschliche Auslösen abends/nachts und spart Quota.

**ML-Exploration-Throttle (v3):** LLM-Exploration für Räume mit unzureichender `learned_policy` läuft pro Raum max. 1× / 30 Min. Persistiert in `system_settings.ml_exploration_throttle` als `{room_id: ts}`. Verhindert Gemini-429-Rate-Limits und reduziert Tuya-Folgecalls bei wiederholten ML-Aktivierungen.

**Batterie-Reserve für Nachverbrauch** (`battery_reserve_for_night_soc`, default 60%) und **Mikro-Budget Modus mit Soft-Rotation** sowie **Tolerante Deaktivierung** bleiben unverändert — letztere greift NICHT mehr wenn Gate aktiv (`!socGateBlocked`).
