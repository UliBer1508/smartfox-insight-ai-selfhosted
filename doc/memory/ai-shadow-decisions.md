---
name: AI Shadow Decisions System
description: Schatten-Modus für KI-Parameter-Vorschläge mit Whitelist, Decision-Log, Outcome-Tracking
type: feature
---

**Architektur:** KI darf Parameter NICHT direkt ändern. Sie schlägt Werte vor und dokumentiert Begründung + erwartetes Ergebnis. Outcome wird täglich gegen `daily_pattern_scores` gemessen.

**Tabellen:**
- `ai_parameter_whitelist` — DB-getriebene Liste erlaubter Parameter mit `min_value`/`max_value`/`allowed_values` und `autonomy_level` (`shadow`/`suggest`/`auto`). Initial alle `shadow`.
- `ai_parameter_decisions` — Log mit `parameter_key`, `current_value`, `proposed_value`, `reasoning`, `confidence`, `context_snapshot`, `expected_outcome`, `decision_mode`, `outcome_score`.

**Edge Functions:**
- `ai-parameter-advisor` — alle 15 min via pg_cron. Lädt Snapshot + Whitelist + KPIs + letzte 20 eigene Entscheidungen, fragt Gemini 2.5 Flash mit JSON-Schema, validiert gegen Whitelist (Range/allowed_values), schreibt nur valide Vorschläge als `decision_mode='shadow'`.
- `ai-parameter-evaluator` — täglich 03:15. Vergleicht `expected_outcome.scr_delta` mit tatsächlichem SCR-Delta vs. Vortag, setzt `outcome_score` (-1..+1).

**Whitelist-Default-Parameter:** comfort_saturation_override_enabled, comfort_override_soc_min/grid_export_min/forecast_min_kwh, parallel_heating_capacity, pattern_recall_strength, heating_min_battery_soc, night_heating_mode, room: pv_boost_max_temp/eco_temp/comfort_temp.

**Bewusst ausgeschlossen:** night_temp (Frostschutz), Nacht-Zeiten, Hardware-Felder.

**UI:** `AIShadowDecisions` Card im HeatingDashboard. Tabelle der letzten 50 Entscheidungen, Filter Alle/Offen/Bewertet, expandierbare Begründung, Aggregations-Chips pro Parameter, Button „Jetzt analysieren". KEIN Apply-Button in dieser Phase.

**Freigabe-Pfad (zukünftig):** `autonomy_level` in `ai_parameter_whitelist` umschalten — `shadow` → `suggest` (Apply-Button) → `auto` (KI schreibt direkt mit Audit-Log).
