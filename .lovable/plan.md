## Diagnose

Aktueller Zustand (gerade eben):
- **PV-Export: ~9.9 kW**, **Batterie: 98.8% SOC**, Prognose heute 42 kWh
- `comfortBudget = 9730 W`, davon nur **1900 W** in Nutzung
- **Alle 12 Räume haben `comfort_saturated_at` von heute** gesetzt

Ursache (Code: `pv-automation/index.ts` Zeilen 2347–2400, Memory `comfort-saturation-estrich-storage`):

Die Komfort-Sättigungs-Logik blockiert jedes Komfort-Upgrade, sobald ein Raum heute schon einmal Komfort erreicht hat. Re-Komfort erlaubt sie erst, wenn `current_temp < eco_temp − 0.5 °C`. Reset erfolgt erst beim Nacht-Übergang.

Da derzeit alle Räume bei oder über `eco_temp − 0.5` liegen, gilt jeder Raum als „gesättigt" → Phase 2 wird komplett übersprungen, obwohl `comfortBudget = 9730 W` und Battery-Full-Bonus aktiv sind. Die ~9.9 kW Überschuss gehen ins Netz statt in den Estrich.

Das ist designtes Verhalten („Estrich speichert"), aber bei voller Batterie + großem anhaltenden Export zu konservativ.

## Lösung

**Battery-Full-Override** für die Saturation-Sperre: Wenn Batterie voll, anhaltender Echt-Export hoch und genug Tagesprognose übrig, darf das System die heutige Sättigung überstimmen und Komfort-Upgrades durchführen — bis ein Raum den `pv_boost_max_temp`-Hardcap erreicht.

### Bedingungen für Override (alle müssen gelten)

- `batterySoc ≥ 95 %`
- `gridExport ≥ 3000 W` (echter Zähler-Export, nicht effective)
- Tagesprognose-Rest ≥ 5 kWh (verhindert Override am Spätnachmittag)
- Raum hat `pv_boost_max_temp` gesetzt UND `current_temp < pv_boost_max_temp − 0.2 °C`

### Code-Änderung

Eine Stelle in `supabase/functions/pv-automation/index.ts`:

1. Vor der Schleife in Zeile ~2362 (Komfort-Sättigungs-Block) und der Schleife in Zeile ~2389 (Phase 2) berechne ein `batteryFullOverride`-Flag.
2. `isComfortSaturated()` gibt `false` zurück, wenn Override aktiv und Raum unter `pv_boost_max_temp` liegt.
3. Im Sättigungs-Block (Z. 2369–2384) wird `reachedComfort` an Override gekoppelt: bei aktivem Override wird `comfort_saturated_at` nicht neu gesetzt, solange `current < pv_boost_max_temp`.
4. Logging mit Tag `[BATTERY-FULL-OVERRIDE]` für Nachvollziehbarkeit.

### Out of Scope

- Keine Änderung an Eco-/Comfort-Budget-Berechnung
- Keine Änderung an Nacht-Logik, SOC-Gate oder Hardcap (`pv_boost_max_temp` bleibt absolute Obergrenze)
- Keine UI-/Settings-Änderung — Schwellwerte sind als Konstanten gut, da das ein Edge-Case ist
- Kein Schema- oder Migrations-Bedarf

### Erwartetes Verhalten

Im aktuellen Zustand würden Räume mit `pv_boost_max_temp > current_temp` (z. B. Bad Uli 20.5 °C, Wohnzimmer 21.5 °C, falls Boost-Cap z. B. 23 °C) wieder Komfort-Setpoint bekommen, bis Batterie unter 95 % fällt oder Cap erreicht.
