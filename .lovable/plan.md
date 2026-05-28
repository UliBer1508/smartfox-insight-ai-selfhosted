# SOC-Empfehlungen konsolidieren

Ziel: Nur noch **eine** Stelle im UI zeigt/akzeptiert SOC-Vorschläge — die „KI Batterie-Empfehlung"-Karte (Übersicht, gespeist aus `battery_soc_suggestions`).

## A) Quelle 2 entfernen — AIShadowDecisions zeigt keine SOC-Parameter mehr

1. **Whitelist deaktivieren** (Migration): `UPDATE ai_parameter_whitelist SET enabled=false` für
   - `heating_min_battery_soc`
   - `battery_reserve_for_night_soc`
   - `micro_budget_min_battery_soc`
2. **Hard-Filter in `ai-parameter-advisor/index.ts`** (Hauptlauf): SOC-Keys werden weder vorgeschlagen noch in `ai_parameter_decisions` geschrieben — auch wenn jemand die Whitelist später wieder aktiviert.
3. **Client-Guard in `AIShadowDecisions.tsx`**: `applyDecision()` lehnt SOC-Keys ab und verweist auf die KI-Batterie-Empfehlung. Filter zusätzlich beim Anzeigen (defensiv).

## B) Quelle 3 — `BatteryReserveStatus` wird Signal statt Empfehlung

1. **`validate-battery-reserve/index.ts`**: nach Auswertung der Morgen-SOC ruft die Funktion intern `ai-parameter-advisor/suggest-battery-soc` auf und übergibt `{ morningSoc, reserveHeld, nightConsumptionKwh, heatingBatteryUsedKwh, suggestionText }`. Schreibt weiterhin `system_settings.battery_reserve_validation` (für Diagnose), aber `suggestion` wird nur noch als interner Trigger/Diagnose-Chip behandelt.
2. **`BatteryReserveStatus.tsx`**: zeigt Validierungsergebnis (gehalten/unterschritten) + kleiner Hinweis „Fließt in die nächste KI-Batterie-Empfehlung ein". Keine eigene „Empfehlung: SOC ändern auf X%"-Zeile mehr, kein Apply-Button.

## C) Quelle 1 erweitern — `BatterySocSuggestionCard` / `ai-parameter-advisor/suggest-battery-soc`

1. **Edge-Function** akzeptiert optionalen `validation`-Block. Regel-Erweiterung:
   - Wenn `reserveHeld=false` und Heizung Batterie genutzt → Vorschlag „Reserve erhöhen" verstärken.
   - Wenn `reserveHeld=true` und SOC am Morgen deutlich > Reserve → Vorschlag „Reserve senken" verstärken.
   - PV-Forecast-Regel bleibt Hauptauslöser; Validierungs-Signal als zusätzliche Begründung in `reason_text`.
2. **Upsert statt Skip**: Falls bereits ein `pending`-Vorschlag existiert und ein stärkeres Signal kommt → bestehenden Eintrag aktualisieren (neuer `new_value` + erweiterter `reason_text`).
3. **`BatterySocSuggestionCard.tsx`**: Footer-Zeile „Auslöser: PV-Forecast · Reserve-Validierung" + erweiterter `reason_text`.

## D) Memory & Doku

- `mem://config/soc-thresholds-consolidated` aktualisieren: einzige UI-Quelle = KI-Batterie-Empfehlung.
- `mem://config/ki-locked-core-params` ergänzen: SOC-Keys hart geblockt im Advisor.

## Technische Details — geänderte Dateien

- `supabase/functions/ai-parameter-advisor/index.ts` — `LOCKED_SOC_KEYS` Konstante, Filter in Main-Run, Erweiterung `/suggest-battery-soc` für `validation`-Input und Upsert-Logik
- `supabase/functions/validate-battery-reserve/index.ts` — interner Aufruf von `/suggest-battery-soc`
- `src/components/heating/AIShadowDecisions.tsx` — Display- und Apply-Guard für SOC-Keys
- `src/components/heating/BatteryReserveStatus.tsx` — Empfehlungs-UI durch Diagnose-Chip ersetzen
- `src/components/dashboard/BatterySocSuggestionCard.tsx` — Footer + erweiterter Reason
- Migration: Whitelist-Disable für 3 SOC-Keys
- 2 Memory-Files

## Was nicht geändert wird

- Datenmodelle/Tabellen (nur Whitelist-Daten-Update)
- Andere Whitelist-Parameter (Temperaturen, Schwellen) bleiben in AIShadowDecisions sichtbar/applybar
- `pv-automation` Setpoint-Logik
