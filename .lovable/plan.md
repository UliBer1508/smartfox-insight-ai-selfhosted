## Problem

Die KI-Musteranalyse läuft automatisch:
- Cron-Dispatcher `analysis-scheduler` (alle 15 min)
- `scheduler_daily`, `scheduler_weekly`, `scheduler_match_today` haben heute alle `last_run_date = 2026-05-24`

ABER `match_today` speichert in `system_settings.best_match_today` keinen Match, sondern einen Postgres-Fehler:

```
column reference "sig_pv_bucket" is ambiguous
hint: It could refer to either a PL/pgSQL variable or a table column.
```

Dadurch zeigt der Pattern-Recall-Block dauerhaft „Kein Match" und der Komfort-Bonus aus dem Pattern-Recall wird nie wirksam.

## Ursache

In der DB-Funktion `public.match_today_pattern(jsonb, int)` enthält die `RETURNS TABLE`-Signatur eine Spalte `sig_pv_bucket`. In der `ranked`-CTE wird `sig_pv_bucket` unqualifiziert verwendet (in `CASE WHEN sig_pv_bucket = pv` und `WHERE ... OR sig_pv_bucket = pv`), was mit dem Output-Parameter gleichen Namens kollidiert.

## Fix

### 1. Migration: Funktion neu definieren, Spalte qualifizieren

`CREATE OR REPLACE FUNCTION public.match_today_pattern(...)` mit:
- `scored.sig_pv_bucket = pv` in der `CASE`-Klausel
- `scored.sig_pv_bucket = pv` in der `WHERE`-Klausel der `ranked`-CTE
- Rest unverändert (SECURITY DEFINER, search_path=public, Signatur identisch).

### 2. Match-Today einmal manuell anstoßen

Nach der Migration `analyze-patterns` mit `{ type: 'match_today' }` aufrufen, damit `best_match_today` sofort einen sauberen Wert bekommt und der Pattern-Recall-Block sichtbar arbeitet.

### 3. Sichtbares Status-Feedback im UI (kleine UX-Verbesserung)

In `src/components/heating/PatternRecallBlock.tsx`:
- Wenn `match?.top_days` ein Objekt mit `code`/`message` ist (statt Array), als Fehler-Badge anzeigen („Fehler bei letztem Match: …") statt stumm „Kein Match".
- Optional `computed_at` als „zuletzt: HH:MM" anzeigen, damit der User sieht, dass die Automatik gelaufen ist.

Keine Änderungen am Scheduler, an Cron oder an `heating_settings` nötig — die Automatik ist korrekt konfiguriert und feuert.

## Out of scope

- Anpassungen an `analysis_daily`/`weekly`/`monthly`-Logik (laufen sauber).
- Änderungen an `pattern_recall_strength` o.ä. Tuning-Parametern.
