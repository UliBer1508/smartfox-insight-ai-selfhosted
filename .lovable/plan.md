## Ziel

Über der Vorschlagsliste in **KI-Parameter-Vorschläge** einen kompakten Block **„Heute geplant von KI"** einblenden, der den Tagesplan vom `ai-daily-planner` (06:00, Claude Haiku) zeigt.

## Problem in der aktuellen Implementierung

Der `ai-daily-planner` schreibt in `heating_recommendations`, aber die Tabelle passt nicht zum Format:

- Spalte `date` ist `NOT NULL` und wird **nicht gesetzt** (nur `valid_for_date`) → Insert würde scheitern.
- UNIQUE auf `(date, period_number)` → mehrere Räume pro Tag kollidieren.
- CHECK auf `priority` lässt nur `battery|heating|conservation` zu — Planner schreibt `ai_planner` → CHECK violation.
- Kein `room_id` → Plan ist nicht pro Raum referenzierbar in der UI.

Statt diese Tabelle umzubauen (die wird von der bestehenden Heat-Logik genutzt), legen wir eine **eigene saubere Tabelle** für den Tagesplan an.

## Änderungen

### 1) Migration — neue Tabelle `ai_daily_plans`

```text
ai_daily_plans
  id              uuid pk
  plan_date       date unique (1 Plan pro Tag)
  source          text  (claude-haiku | gemini-flash-fallback)
  overall_strategy text
  time_blocks     jsonb   (Array {start_time, end_time, strategy})
  rooms           jsonb   (Array {room_id, room_name, priority_rank, recommended_temp, reasoning})
  raw_plan        jsonb   (vollständige KI-Antwort, für Debug)
  created_at      timestamptz
```

RLS:
- authenticated: full access
- anon: SELECT only (UI ohne Login soll lesen können)
- service_role: full (Edge Function schreibt)

### 2) Edge Function `ai-daily-planner` anpassen

- Statt in `heating_recommendations` zu schreiben, **UPSERT** auf `ai_daily_plans` (`plan_date = today`).
- `rooms` als komplettes Array speichern (inkl. room_id, room_name).
- `overall_strategy` und `time_blocks` als eigene Spalten.

### 3) UI — neue Komponente `AIDailyPlanCard`

In `src/components/heating/` neu anlegen. Sie wird in `AIShadowDecisions.tsx` direkt **über** der Vorschlagsliste (vor dem Filter „Alle / Offen / Bewertet") gerendert.

Anzeige:
- Header: „Tagesplan KI · {plan_date}" + Quelle-Badge (Claude / Gemini-Fallback)
- `overall_strategy` (Klartext, expand/collapse bei >200 Zeichen)
- Optional: kleine Zeitleiste der `time_blocks` (Chips: `06:00–10:00 · Eco-Heizung`)
- Tabelle der Räume sortiert nach `priority_rank`: Raum · Rang · Empf. Temp · 1-Satz-Reasoning
- Falls heute kein Plan existiert: dezenter Hinweis „Heute noch kein Tagesplan – läuft täglich um 06:00. [Jetzt erzeugen]" (Button triggert `ai-daily-planner` per `supabase.functions.invoke`).

### 4) Types

Werden nach der Migration automatisch in `src/integrations/supabase/types.ts` aktualisiert.

## Nicht enthalten

- Keine Änderungen an `pv-automation`. Der Plan wird (in dieser Iteration) nur **angezeigt**, noch nicht in die Setpoint-Logik eingespeist. Das ist ein bewusster nächster Schritt, sobald der Plan-Output stabil aussieht.
- Keine Cleanup-Cron für `ai_daily_plans` (kommt später; vorerst maximal 1 Zeile pro Tag).
