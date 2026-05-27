
## Befund

Die beiden Buttons machen **unterschiedliche Dinge**, das ist aktuell nur schlecht beschriftet:

**1. „Neu" (oben im KI-Zusammenfassung-Kasten)**
- Ruft Edge Function `analysis-summary` → Gemini erzeugt einen kurzen Klartext aus den bereits berechneten `daily_pattern_scores`.
- Cache liegt in `system_settings.analysis_summary_day|week|month`.
- **Läuft aktuell NICHT automatisch** — wird nur bei Klick erzeugt. Deshalb steht da auch noch ein alter Stand (24.5.2026).

**2. „Tagesanalyse jetzt starten" (unten)**
- Ruft `analyzeDailyPattern(readings)` → analysiert die Rohmesswerte des Tages und schreibt ein neues Pattern in `daily_patterns` / `daily_pattern_scores`.
- **Läuft bereits automatisch** über `analysis-scheduler` (pg_cron alle 15 min) zur in den Settings konfigurierten Uhrzeit (`analysis_daily_time`, `analysis_daily_enabled`). Der „AutomationBox"-Block direkt darunter zeigt das auch an.

→ Sie machen also nicht dasselbe: „Tagesanalyse" erzeugt die **Datenbasis**, „KI-Zusammenfassung" erzeugt den **Klartext** darüber. Die Klartext-Stufe fehlt im Auto-Scheduler.

Außerdem ist der Text auf der Karte abgeschnitten („…und zeigt") — entweder durch CSS-Clamp oder weil Gemini selbst nur einen halben Satz geliefert hat.

## Plan

### 1. KI-Zusammenfassung in den Auto-Scheduler einhängen
In `supabase/functions/analysis-scheduler/index.ts` direkt nach jedem erfolgreich getriggerten Job zusätzlich `analysis-summary` mit passendem `type` aufrufen:
- nach `compute-daily-score` → `analysis-summary { type: 'day' }`
- nach `weekly_comparison_auto` → `analysis-summary { type: 'week' }`
- nach `monthly_pattern` → `analysis-summary { type: 'month' }`

Dadurch ist die Klartext-Zusammenfassung nach jedem automatischen Lauf frisch, der „Neu"-Button bleibt nur noch als manueller Override.

### 2. Selbstheilung: Stale-Detection beim Laden
In `useAnalysisSummary.ts`: wenn `generated_at` älter als die letzte `last_run`-Markierung des passenden Scheduler-Jobs ist (oder älter als 24 h für `day`, 7 d für `week`, 30 d für `month`) → automatisch einmal `generate()` aufrufen. So füllt sich die Karte beim Öffnen selbst, falls der Scheduler noch nichts gemacht hat.

### 3. UI entwirren in `AnalysisPanel.tsx` / `ProgressCockpit.tsx`
- „Neu"-Button umbenennen in **„Text neu erzeugen"** mit Tooltip „KI-Klartext basierend auf den letzten Auswertungen neu schreiben".
- Den großen Button **„Tagesanalyse jetzt starten"** umbenennen in **„Tagesmuster neu auswerten"** mit Tooltip „Erzeugt aus den Rohmesswerten ein neues Tagesmuster — läuft normalerweise automatisch um {analysis\_daily\_time}".
- Im KI-Zusammenfassungs-Kasten unter dem Stand zusätzlich anzeigen, wann der nächste Auto-Lauf ist (aus AutomationBox-Logik wiederverwenden), damit klar ist, dass die Karte sich selbst aktualisiert.

### 4. Abgeschnittenen Text fixen
In `ProgressCockpit.tsx` prüfen, ob ein `line-clamp` oder eine zu kurze `max_tokens`-Vorgabe in `analysis-summary/index.ts` für den halben Satz verantwortlich ist, und entsprechend lockern (volle 2–3 Sätze rendern, kein `line-clamp-1`).

## Was sich für den Nutzer ändert

- Die KI-Zusammenfassung aktualisiert sich automatisch nach jedem Tages-/Wochen-/Monatslauf.
- Beim Öffnen der Seite holt sie sich bei Bedarf selbst einen frischen Text.
- Beschriftungen + Tooltips machen klar, dass die zwei Buttons unterschiedliche Stufen derselben Pipeline sind und beide normalerweise automatisch laufen.
- Der Klartext wird vollständig angezeigt, nicht mehr abgeschnitten.

## Technische Notizen

- Keine neuen Tabellen, keine Migration.
- Eine kleine Änderung an Edge Function `analysis-scheduler` (zusätzliche `invokeFn`-Aufrufe), automatisch deployed.
- Frontend-Änderungen in `useAnalysisSummary.ts`, `ProgressCockpit.tsx`, `AnalysisPanel.tsx`.
- Risikoarm: bei Fehler von `analysis-summary` bleibt einfach der alte Cache stehen.
