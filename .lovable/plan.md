## Ursache

Der Fehler `record "new" has no field "updated_at"` blockiert sowohl `analyze-patterns` als auch `ai-parameter-advisor` beim Schreiben in `ai_parameter_decisions`. Dadurch bekommt die KI‑Musteranalyse keine neuen Vorschläge → "Keine KI-Vorschläge verfügbar".

Auf der Tabelle `public.ai_parameter_decisions` liegt ein fehlerhaft konfigurierter Trigger:

```
trg_ai_decisions_validate_outcome
  BEFORE INSERT OR UPDATE ON ai_parameter_decisions
  EXECUTE FUNCTION update_updated_at_column()
```

Die Funktion setzt `NEW.updated_at = now()`, aber die Tabelle hat **keine** Spalte `updated_at` (nur `created_at`, `applied_at`, `outcome_evaluated_at`, `rollback_at`). Jeder INSERT schlägt fehl.

Der Name `validate_outcome` deutet darauf hin, dass hier ursprünglich eine andere Funktion gemeint war — der Trigger wurde fälschlich an `update_updated_at_column` gebunden.

## Fix

Migration:
1. `DROP TRIGGER trg_ai_decisions_validate_outcome ON public.ai_parameter_decisions` — der Trigger hat keine sinnvolle Funktion und blockiert nur Writes.

Keine Schema-Erweiterung nötig: `updated_at` wird in dieser Tabelle nirgendwo gelesen, alle relevanten Zeitstempel existieren bereits (`created_at`, `applied_at`, `outcome_evaluated_at`).

## Verifikation

- `ai-parameter-advisor` per curl triggern → Response zeigt `accepted > 0` statt 500.
- UI lädt KI-Vorschläge wieder, Fehlermeldung verschwindet.
