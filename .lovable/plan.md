## Lösungskonzept

Sechs zusammenhängende Korrekturen rund um den SOC-Gate-/Mikro-Budget-/WW-Pfad plus ein Schreibschutz für Kernparameter gegen die KI.

### Fix 1 — `heatingMinSoc`: deprecated Fallback entfernen

Datei: `supabase/functions/pv-automation/index.ts` (Zeile 1392–1394)

```ts
// Einzige Source of Truth: heating_min_battery_soc.
// battery_reserve_for_night_soc ist @deprecated und darf NICHT mehr als Gate-Fallback dienen.
const heatingMinSoc = settings?.heating_min_battery_soc ?? 80;
```

Einmalige Migration in `src/hooks/useHeatingSettings.ts` beim ersten Laden: wenn `heating_min_battery_soc == null` und `battery_reserve_for_night_soc` einen Wert hat → diesen Wert nach `heating_min_battery_soc` schreiben (Insert/Update auf der bestehenden Row). Nur einmal — danach steht der korrekte Wert in der DB.

Die bereits vorhandene Save-Spiegelung (`battery_reserve_for_night_soc = heating_min_battery_soc`) bleibt für Backwards-Compat.

### Fix 2 — Soft-Gate: Eco blockieren, wenn Batterie nicht aktiv lädt

Datei: `supabase/functions/pv-automation/index.ts` (~Zeile 1822–1826)

```ts
} else {
  // soft: Komfort hart auf 0.
  // Eco: Neue Aktivierungen blockieren, wenn Batterie gerade NICHT aktiv lädt
  // (verhindert Batterie-Entladung durch Eco-Heizung ohne PV-Deckung).
  comfortBudget = 0;
  if (batteryPower <= 50) {
    availableBudget = 0;
    console.log(`[SOC-GATE] ⚠️ SOFT+kein Laden: SOC ${batterySoc}% < ${heatingMinSoc}%, Batterie idle (${Math.round(batteryPower)}W) → Eco-Budget ebenfalls 0W`);
  } else {
    console.log(`[SOC-GATE] ⚠️ SOFT: SOC ${batterySoc}% < ${heatingMinSoc}%, batteryPower=${Math.round(batteryPower)}W → Komfort=0W`);
  }
}
```

### Fix 3 — Mikro-Budget respektiert PV-Hysterese

Datei: `supabase/functions/pv-automation/index.ts` (~Zeile 2282, vor dem `stillRunning`/`picked`-Block)

Neue Vorab-Bedingung: `gridExport < pv_surplus_threshold_on` → kein Mikro-Start, mit Log. Die bestehende `picked`-Logik bleibt unverändert dahinter.

```ts
const pvThresholdOnLocal = settings?.pv_surplus_threshold_on ?? DEFAULT_PV_SURPLUS_THRESHOLD_ON;
if (gridExport < pvThresholdOnLocal) {
  console.log(`[MICRO-BUDGET] Hysterese blockiert: gridExport ${gridExport}W < On-Schwelle ${pvThresholdOnLocal}W → kein Mikro-Budget-Start`);
} else if (stillRunning) { ... } else if (minutesSinceLastMicro >= roomRotationMinutes) { ... }
```

### Fix 4 — WW-Reserve aus Budget-Logik entfernen

Datei: `supabase/functions/pv-automation/index.ts` (Zeile 2558–2566)

Block `if (hotwaterActive && comfortBudget > 0) { comfortBudget -= hotwaterPower; ... }` wird vollständig entfernt. `hotwaterActive`-Check und Logging bleiben für Monitoring/`superComfortAllowed`-Gate erhalten. Konsistent mit Memory `hotwater-smartfox-autonomous`.

### Fix 5 — UI: Klartext-Hinweis + Migrations-Banner

Datei: `src/components/heating/HeatingSettingsForm.tsx`

- Unter dem Slider `heating_min_battery_soc` einen Info-Kasten (`<Alert>`) mit dem vorgegebenen Text einfügen.
- Migrations-Banner (einmalig, mit „Verstanden"-Button, Status in `localStorage`): wird nur gezeigt, wenn beide DB-Felder existieren und unterschiedlich sind. Wenn `battery_reserve_for_night_soc > heating_min_battery_soc` und `heating_min_battery_soc` null/Default → höheren Wert übernehmen.

### Fix 6 — LOCKED_PARAMS-Guard für KI-Funktionen

Datei: `supabase/functions/ai-parameter-advisor/index.ts` und `supabase/functions/ai-parameter-evaluator/index.ts`

Beide Funktionen sollen einen expliziten Schreibschutz erhalten:

```ts
const LOCKED_PARAMS = [
  'heating_min_battery_soc',
  'pv_surplus_threshold_on',
  'pv_surplus_threshold_off',
  'micro_budget_min_battery_soc',
  'night_start_time',
  'night_end_time',
];
```

- Im Advisor: nach KI-Antwort Vorschläge mit `parameter_key ∈ LOCKED_PARAMS` aussortieren (vor dem Insert in `ai_parameter_decisions`).
- Im Evaluator: kein Auto-Apply, kein Update auf `heating_settings` für gesperrte Keys (defensiv, auch wenn Whitelist auf `shadow` steht).
- Lesen + Empfehlen bleibt erlaubt; Schreiben ist hart geblockt.

### Verifikation

- `pv-automation` Logs: `heatingMinSoc` folgt nur noch `heating_min_battery_soc`.
- SOC < Gate + Batterie idle + Modus `soft` → Log `[SOC-GATE] ⚠️ SOFT+kein Laden`, `availableBudget = 0`.
- `gridExport < pv_surplus_threshold_on` → Log `[MICRO-BUDGET] Hysterese blockiert`, kein neuer Mikro-Raum.
- Bei aktivem WW: kein `🚿 WW aktiv → Komfort-Budget reduziert`-Log mehr; `comfortBudget` bleibt unverändert.
- UI: Info-Kasten sichtbar; Migrations-Banner erscheint nur bei abweichenden DB-Werten und nur einmal.
- Advisor-Decisions enthalten keine `LOCKED_PARAMS`-Keys mehr.

### Nicht geändert

- DB-Schema (Spalten bleiben für Backwards-Compat).
- Bestehende ML/AI-Logik, ausgenommen LOCKED_PARAMS-Filter.
- Tuya-/Local-Service-Pfad.
