
# Reward-Funktion in evaluate-decision ueberarbeiten

## Problemanalyse (aus den Daten)

Die aktuellen Durchschnittswerte pro Reward-Komponente zeigen klare Verzerrungen:

| Komponente | activate | deactivate |
|---|---|---|
| energy_cost | -0.317 | **-0.873** |
| pv_usage_bonus | 0.260 | **0.064** |
| comfort_bonus | **-0.455** | **0.000** |
| battery_efficiency | -0.075 | -0.031 |
| efficiency_bonus | -0.003 | -0.005 |
| forecast_quality | -0.038 | -0.042 |
| **GESAMT** | **-0.628** | **-0.887** |

### Problem 1: `deactivate` bekommt hohe `energy_cost` Strafe
- Bei `deactivate` wird die Heizung abgeschaltet, aber der `energy_cost` misst den **gesamten Hausverbrauch** im 2-Stunden-Fenster (Kueche, Licht, etc.)
- Das bestraft `deactivate` fuer Energieverbrauch, der nichts mit der Heizentscheidung zu tun hat
- **Fix:** Bei `deactivate`-Entscheidungen nur den heizungsbezogenen Anteil des Netzimports beruecksichtigen, oder einen Energiespar-Bonus geben

### Problem 2: `deactivate` bekommt keinen Komfort-Bonus (immer 0)
- Zeile 322: `else { breakdown.comfort_bonus = 0; }` -- alle nicht-activate Entscheidungen bekommen 0
- Ein erfolgreiches `deactivate` (Temperatur bleibt ueber Minimum) sollte belohnt werden
- Ein schlechtes `deactivate` (Temperatur faellt unter night_temp) sollte bestraft werden

### Problem 3: Kein Energiespar-Bonus fuer `deactivate`
- Wenn die Heizung erfolgreich pausiert wird, spart das Energie
- Diese Einsparung wird nie als positiver Reward erfasst
- **Fix:** Geschaetzte eingesparte Wh basierend auf Raumleistung und Dauer berechnen

## Loesung: Ueberarbeitete calculateReward Funktion

### Aenderung 1: Energiekosten-Komponente differenzieren (Zeilen 292-294)
```typescript
// 1. Energiekosten-Komponente
const gridCostEur = (outcome.grid_import_wh / 1000) * (electricityPrice / 100);
if (event.decision_type === 'deactivate') {
  // Bei deactivate: Netzimport ist nicht durch diese Entscheidung verursacht
  // Nur leicht negativ bewerten (Grundlast des Hauses)
  breakdown.energy_cost = -gridCostEur * 0.1;
} else {
  // Bei activate: Voller Netzimport ist relevant
  breakdown.energy_cost = -gridCostEur;
}
```

### Aenderung 2: Komfort-Komponente fuer `deactivate` erweitern (Zeilen 313-324)
```typescript
// 4. Komfort-Komponente
if (event.decision_type === 'activate' || event.decision_type === 'heating_on' 
    || event.decision_type === 'preheat') {
  // ... bestehende Logik bleibt ...
} else if (event.decision_type === 'deactivate') {
  // Deactivate-Komfort: Temperatur sollte nicht unter Minimum fallen
  const minTemp = event.context?.night_temp || event.context?.min_temp || 16;
  if (outcome.temp_end !== null) {
    if (outcome.temp_end >= minTemp) {
      // Temperatur ueber Minimum gehalten = gute Entscheidung
      breakdown.comfort_bonus = 0.3;
    } else if (outcome.temp_end >= minTemp - 1) {
      // Knapp unter Minimum = leicht negativ
      breakdown.comfort_bonus = -0.2;
    } else {
      // Deutlich unter Minimum = schlecht
      breakdown.comfort_bonus = -0.8;
    }
  } else {
    breakdown.comfort_bonus = 0;
  }
} else {
  breakdown.comfort_bonus = 0;
}
```

### Aenderung 3: Neuer Energiespar-Bonus fuer `deactivate` (nach Zeile 335)
```typescript
// 5b. Energiespar-Bonus (nur fuer deactivate)
if (event.decision_type === 'deactivate') {
  // Schaetze eingesparte Energie: Raumleistung * 2h Fenster
  const roomPowerW = event.context?.room_power_w || 800;
  const savedKwh = (roomPowerW * 2) / 1000; // 2h Evaluierungsfenster
  const savedEur = savedKwh * (electricityPrice / 100);
  // Bonus proportional zur Einsparung, max 0.5
  breakdown.energy_saving_bonus = Math.min(0.5, savedEur * 0.5);
} else {
  breakdown.energy_saving_bonus = 0;
}
```

### Aenderung 4: Context muss room_power_w und night_temp enthalten
In `pv-automation/index.ts` muessen beim Erstellen von `learning_events` die Felder `room_power_w` und `night_temp` im `context` Objekt gesetzt werden. Das ist wahrscheinlich schon der Fall -- pruefe und ergaenze wenn noetig.

## Erwartete Auswirkung

Nach diesen Aenderungen:
- **deactivate avg reward:** von -0.887 auf ca. +0.1 bis +0.3 (Energiespar-Bonus + reduzierte energy_cost + Komfort-Bonus)
- **activate avg reward:** von -0.628 auf ca. -0.3 bis +0.2 (energy_cost bleibt, aber weniger Verzerrung)
- **Policies lernen korrekt:** `deactivate` nachts wird als positiv bewertet, `activate` bei PV-Ueberschuss ebenso

## Dateien zu aendern

1. `supabase/functions/evaluate-decision/index.ts` -- calculateReward ueberarbeiten (Zeilen 290-355)
2. `supabase/functions/pv-automation/index.ts` -- pruefen ob `context` bei learning_event Erstellung `room_power_w` und `night_temp` enthaelt

## Risiken
- Bestehende evaluierte Events behalten ihren alten Reward -- nur neue Events profitieren
- Optional: Re-Evaluation aller Events auslösen nach Deploy (via `evaluate_all: true` mit `is_evaluated` Reset)
