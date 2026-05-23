## Problem

In der KI-Parameter-Liste (`AIShadowDecisions`) wächst die Anzahl Einträge stetig — aktuell 87 Zeilen in 16 h, ~10–25 pro Advisor-Lauf, davon 62 unbewertet, 0 angewendet.

Ursachen:
- **Kein Cleanup-Cron** für die Tabelle `ai_parameter_decisions` (anders als `ml_decision_events`, das von `evaluate-decision` verarbeitet wird).
- **Kein Bewertungs-Job** für diese Tabelle — `outcome_evaluated_at` bleibt immer NULL, deshalb wird nichts „abgehakt".
- Frontend lädt zwar nur `.limit(100)`, aber die DB selbst wächst unbegrenzt → Performance, Rauschen, Tabelle wird unübersichtlich.

## Lösung — zwei Ebenen

### 1. Datenbank-Retention (Migration + pg_cron)

Neue Cleanup-Routine, einmal täglich:

```sql
DELETE FROM ai_parameter_decisions
WHERE
  -- Angewendete/bewertete Vorschläge: 30 Tage aufheben
  (applied_at IS NOT NULL AND created_at < now() - interval '30 days')
  OR (outcome_evaluated_at IS NOT NULL AND created_at < now() - interval '30 days')
  -- Nicht angewendete Schatten-Vorschläge: 7 Tage aufheben
  OR (applied_at IS NULL AND created_at < now() - interval '7 days');
```

Plus harte Obergrenze als Sicherheitsnetz (falls Advisor mal Amok läuft): nach Cleanup die ältesten Zeilen droppen, sobald > 500 Zeilen.

pg_cron: `daily-ai-decisions-cleanup`, läuft 02:45 UTC (passt zwischen die bestehenden Cleanup-Jobs).

### 2. Frontend — sichtbare Begrenzung (`AIShadowDecisions.tsx`)

- Default-Filter beim Mount auf **„Offen"** statt „Alle" setzen → User sieht zuerst relevante Entscheidungen, alte Bewertete verstecken sich.
- Liste-Limit von **100 → 50** reduzieren (selbst mit Wachstum noch handhabbar, Rest via Filter erreichbar).
- Im Card-Header neben dem Zähler-Badge einen kleinen Hinweis „letzte 50 · Retention 7/30 Tage" einblenden, damit transparent ist, dass nicht alles ewig sichtbar bleibt.

## Was *nicht* angefasst wird

- Advisor-Cron (`ai-parameter-advisor`) bleibt unverändert — er soll weiter Vorschläge erzeugen.
- Logik für Apply, Whitelist, Outcome-Score bleibt identisch.
- Keine Änderung an `ml_decision_events` (hat bereits eigenen Pfad).

## Technische Details

| Bereich | Änderung |
|---|---|
| Migration | `DELETE`-Funktion + pg_cron-Schedule |
| `AIShadowDecisions.tsx` | `useState<filter>` Default `'unevaluated'`, `.limit(100)` → `.limit(50)`, Retention-Hinweis im Header |
| Memory | Eintrag unter „Stale Data Policy" um `ai_parameter_decisions: 7d unevaluated / 30d evaluated / 500 hard cap` ergänzen |

Keine Auswirkung auf Hardware, Heizlogik oder Autopilot.
