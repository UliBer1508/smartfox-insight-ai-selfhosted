## Befund

Die in der Edge Function umgesetzte Logik (`supabase/functions/pv-automation/index.ts`, Zeile 1634–1960) entspricht **bereits exakt** deiner Anforderung:

- **Phase 1 (Eco):** Räume unter `eco_temp` werden nach Priorität 1–12 auf Eco geheizt, solange `availableBudget` (inkl. Prognose-/Trend-/Batterie-Bonus) reicht.
- **Phase 2 (Komfort):** Läuft **parallel** zu Phase 1. Räume mit `currentTemp ≥ eco_temp − 0,3 °C` dürfen auf `comfort_temp` hochgesetzt werden — **ausschließlich** wenn echtes `comfortBudget` (= `gridExport`, **kein** Bonus, **keine** Batterie, **kein** WW-Reserve-Abzug) reicht.
- **Komfort-Hard-Lock:** `batterySoc < heating_min_battery_soc` (80 %) → `comfortBudget = 0`.

Es gibt **nichts am Code zu ändern**. Die heutige Beobachtung „nicht alle Räume auf Komfort" ist die korrekte Konsequenz von:
1. Komfort-Budget = nur echter Export (war bis vorhin durch WW-Reserve doppelt gebucht — ist gefixt)
2. Tuya-Quota 208/200 erschöpft → Befehle werden verworfen, nicht weil die Logik falsch ist

## Problem in der Doku

Die zentrale Memory `mem://arch/pv-automation-strategy-v2` (DB-Eintrag, der bei jedem Loop in den Kontext geladen wird) beschreibt noch die **alte sequentielle** Strategie:

> „Erst wenn alle Räume Eco erreicht haben oder das Budget für Eco erschöpft ist, startet Phase 2 für Komfort-Upgrades."

Die **korrekte v2.1**-Beschreibung („Phase 2 läuft parallel, nur echtes `gridExport` für Komfort, nur Räume ≥ Eco − 0,3 °C") existiert nur im lokalen File `.lovable/memory/arch/pv-automation-strategy-v2.md` und wird beim Auto-Reload des DB-Memory nicht gesehen. Genau das ist der Grund, warum ich (und du in den letzten Loops) immer wieder gegen veraltete Annahmen argumentiert habe.

## Plan

### 1. Memory-Update (DB) — `mem://arch/pv-automation-strategy-v2`
Inhalt durch v2.1-Beschreibung ersetzen, exakt synchron zum lokalen File:
- Phase 1 = alle Räume `< eco_temp` nach Priorität auf Eco, Budget = `availableBudget` (mit Boni)
- Phase 2 = **parallel**, Räume `≥ eco_temp − 0,3 °C` dürfen auf `comfort_temp`, Budget = strikt `gridExport`
- Komfort-Hard-Lock bei `batterySoc < heating_min_battery_soc`
- Begründung: warum nicht mehr sequentiell (Verschwendung bei großem Überschuss)

### 2. Memory-Update — `mem://index.md` Core-Zeile
Aktualisieren von:
> „Phase 1 (Eco) for all active priority rooms before Phase 2 (Comfort)."

zu:
> „Phase 1 (Eco) und Phase 2 (Komfort) laufen parallel. Komfort nur für Räume ≥ eco_temp − 0,3 °C und nur aus echtem gridExport."

### 3. Code-Verifikation (read-only Check, keine Änderung)
- Bestätigen dass `effectiveComfortBudget = comfortBudget` (Zeile 1902) wirklich nur den strikten `gridExport`-basierten Wert enthält → bereits geprüft, ist so.
- Bestätigen dass `roomBudgetStatus`-Map keine Eco-Räume in Phase 2 doppelt budgetiert → bereits geprüft (Flag `alreadyBudgeted`).

### 4. Keine Änderungen an
- Edge-Function-Code (Logik ist korrekt)
- HeatingSettingsForm (WW-Hinweis ist drin)
- Datenbank-Schema oder RLS

## Erwartetes Ergebnis nach Umsetzung

- Die DB-Memory beschreibt die tatsächliche Logik. Beim nächsten Loop lese ich nicht mehr den veralteten sequentiellen Text.
- Du erhältst konsistente Antworten: „Räume bleiben auf Eco wenn `comfortBudget` nicht reicht" statt fälschlicher Diagnosen.
- Sobald der Tuya-Quota-Reset um Mitternacht greift und WW-Reserve = 0 wirkt (heute deployed), sollten morgen mehr Räume Komfort erreichen sofern `gridExport` reicht.