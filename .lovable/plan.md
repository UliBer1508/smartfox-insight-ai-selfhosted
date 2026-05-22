## Ziel

Die wöchentlichen Empfehlungen aus `analyze-patterns` (gespeichert in `system_settings.weekly_insight`) und der heutige Pattern-Match (`best_match_today`) sollen vom Autopilot-Advisor (`ai-parameter-advisor`) explizit gewichtet werden — statt wie heute nur als anonymer Teil des generischen `system_settings`-JSON-Dumps mitzufliegen.

## Aktueller Zustand

- `analyze-patterns` persistiert beim wöchentlichen Lauf eine strukturierte `weekly_insight` mit `trend`, `avg_self_consumption_ratio`, `top_grid_import_hours`, `summary` und einer Liste freier `recommendations` (`key`, `value`, `reason`).
- `analyze-patterns` persistiert beim `match_today`-Lauf `best_match_today` mit Signatur, Top-Tagen und `recommended_overrides`.
- `ai-parameter-advisor` lädt zwar alle `system_settings`, der Prompt klatscht sie aber als JSON-Block in den Snapshot — Gemini sieht die Empfehlungen, ohne dass sie inhaltlich hervorgehoben oder bewertet werden.

## Änderungen (1 Datei)

**`supabase/functions/ai-parameter-advisor/index.ts`**

1. Nach dem Aufbau von `sysMap` zwei dedizierte Variablen extrahieren:
   - `weeklyInsight = sysMap['weekly_insight']`
   - `bestMatchToday = sysMap['best_match_today']`
   - `patternRecommendations = weeklyInsight?.recommendations ?? []`
2. Beide Keys aus `sysMap` entfernen (für den generischen Snapshot) → keine Dopplung.
3. Neuen `patternBlock` zusammenstellen mit den relevanten Feldern (Trend, SCR, Top-Grid-Hours, Summary, recommendations + Signatur/Match-Quality/Top-Days/Overrides).
4. Im Prompt einen neuen Block **vor** „REGELN" einfügen:

```
MUSTERANALYSE (analyze-patterns) — explizit zu berücksichtigen:
${JSON.stringify(patternBlock, null, 2)}

REGELN FÜR DEN UMGANG MIT MUSTERANALYSE:
- `weekly_insight.recommendations` sind unverbindliche Hinweise — übersetze sie nur in eine Entscheidung, wenn der Key in der erlaubten Whitelist steht und der Wert in den Grenzen liegt.
- Begründe in `reasoning` explizit, falls du einer Empfehlung folgst ODER bewusst abweichst.
- `best_match_today.recommended_overrides` zeigen, was an einem ähnlichen Vergangenheitstag gut funktioniert hat — als Prior nutzen, nicht blind kopieren.
- Wenn `match_quality = 'none'` oder kein `weekly_insight`: ignoriere den Block.
```

5. Keine Schema-Änderung am `decisions`-Output — die Whitelist bleibt der harte Filter.

## Was sich dadurch ändert

- Advisor-Vorschläge werden nachvollziehbar aus den Wochentrends abgeleitet (z. B. „Top-Grid-Hour = 7 Uhr → `night_end_time` nach hinten").
- Bei einem starken `best_match_today` (z. B. `exact`) erhält der Advisor einen historisch validierten Prior für die Setpoints des Tages.
- Whitelist + Range-Check + Rate-Limit + Auto-Rollback bleiben unverändert — alle Safety-Mechanismen greifen weiter.

## Out of Scope

- Kein neues Cron, keine neuen Tabellen, keine UI-Änderung.
- `apply-recommendations` bleibt weiterhin abgeschaltet (Memory: Setpoint-Autorität nur bei `pv-automation`).
