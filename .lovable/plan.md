## Problem

`daily_pattern_scores` ist die zentrale Lern-/Vergleichsbasis (Advisor, `match_today_pattern`, Pattern-Recall, Progress-Cockpit). Aktuell wird die Tabelle **nur** befüllt, wenn jemand `compute-daily-score` manuell mit `{ "backfill": N }` oder `{ "date": "..." }` aufruft. Es gibt **keinen pg_cron-Eintrag** für `compute-daily-score` (verifiziert: `cron.job` enthält ihn nicht). Lücken müssen daher per Hand gefüllt werden.

## Lösung — drei kleine, unabhängige Änderungen

### 1. Täglicher Cron für „gestern"
Neuer pg_cron-Job:
```
jobname: compute-daily-score-daily
schedule: 30 2 * * *      -- 02:30 UTC = 03:30/04:30 Europe/Vienna, nach 'aggregate-energy-data-daily' (03:00 UTC)
body:    {}                -- Standard = gestern, exakt der bestehende Default
```
Begründung Zeitpunkt: `aggregate-energy-data-daily` läuft um 03:00 UTC, `analysis-scheduler` triggert die Tages-/Wochenanalyse erst über den `analysis_daily_time`-Slot (UI-konfigurierbar, Default 03:30). Wir setzen `compute-daily-score` knapp davor, damit die Wochenanalyse bereits einen frischen Score sieht.

→ via **Supabase Insert Tool** (keine Migration, weil URL+anon-Key enthalten).

### 2. Self-Backfill für Lücken (max 7 Tage rückwirkend)
In `supabase/functions/compute-daily-score/index.ts` am Anfang des Default-Pfads ergänzen:
- Vor dem Score-Lauf prüfen, welche der letzten 7 Tage (`current_date - 7 .. current_date - 1`) in `daily_pattern_scores` fehlen.
- Fehlende Tage in `dates[]` einreihen (max. 7), zusätzlich zu „gestern".
- Bestehender Code für mehrere Dates läuft bereits in einer Schleife — kein weiterer Umbau nötig.

So holt der tägliche Cron Lücken automatisch nach (z. B. wenn Edge Function 1–2 Tage offline war), ohne dass jemals wieder manuell gebackfillt werden muss.

### 3. „Just-in-time"-Self-Heal im Advisor
In `ai-parameter-advisor` (läuft 15-minütlich) vor dem Snapshot prüfen:
- Wenn `daily_pattern_scores` für `current_date - 1` fehlt **und** die aktuelle Zeit > 04:00 Europe/Vienna ist (Daten müssten da sein):
  - Asynchron (fire-and-forget) `compute-daily-score` mit `{}` triggern.
  - Aktueller Advisor-Lauf benutzt den vorhandenen Datenstand — beim nächsten 15-min-Tick ist der Score da.

Damit erholt sich das System auch dann selbst, wenn der 02:30-Cron einmal nicht angestoßen wurde (z. B. Resume nach Pause der Cloud).

## Was sich NICHT ändert
- `compute-daily-score` Endpoint bleibt rückwärtskompatibel — der manuelle Backfill-Button im Frontend (falls vorhanden) funktioniert weiter, ist nur nicht mehr nötig.
- Keine neue Tabelle, keine Schema-Migration.
- Whitelist + Range-Checks + Pattern-Block im Advisor (gerade hinzugefügt) bleiben unverändert.

## Geänderte / neue Dateien
- `supabase/functions/compute-daily-score/index.ts` — Self-Backfill der letzten 7 Tage im Default-Pfad.
- `supabase/functions/ai-parameter-advisor/index.ts` — Just-in-time-Trigger bei fehlendem „gestern"-Score.
- pg_cron-Eintrag `compute-daily-score-daily` (über Insert-Tool).

## Verifikation nach dem Build
- `SELECT date FROM daily_pattern_scores ORDER BY date DESC LIMIT 10;` zeigt heute lückenlos.
- Cron-Liste enthält `compute-daily-score-daily`.
- Advisor-Log enthält ggf. „daily_score missing — triggered backfill".
