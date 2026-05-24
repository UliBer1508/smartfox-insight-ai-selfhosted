## Ziel

1. Sichtbar machen, dass die automatischen Analysen tatsächlich gelaufen sind (Tag/Woche/Monat/Match-Today).
2. Ungenutzten Platz in `AnalysisPanel` reduzieren.

## Datenquelle

Der `analysis-scheduler` schreibt nach jedem Lauf in `system_settings` (siehe edge function):
- `scheduler_daily` → `{ last_run_at, last_run_date }`
- `scheduler_weekly` → `{ last_run_at, last_run_date }`
- `scheduler_monthly` → `{ last_run_at, last_run_date }`
- `scheduler_match_today` → `{ last_run_at, last_run_date }`

Diese Zeitstempel sind aktuell vorhanden, werden aber im UI nicht angezeigt.

## Änderungen in `src/components/energy/AnalysisPanel.tsx`

### A) „Zuletzt gelaufen"-Anzeige

- Neuen kleinen Hook/State im Panel: einmaliges `useEffect`, das beim Mount per `supabase.from('system_settings').select('key,value').in('key', ['scheduler_daily','scheduler_weekly','scheduler_monthly','scheduler_match_today'])` lädt und alle 5 min refresht.
- Map auf `Record<schedulerKey, string | null>`.
- `AutomationBox` bekommt eine neue optionale Prop `lastRunAt?: string | null` und rendert wenn aktiviert eine zweite Mini-Zeile rechts neben dem Switch:
  - grünes Punkt-Badge + `Zuletzt: HEUTE 03:30` (heute → „heute HH:MM", gestern → „gestern HH:MM", sonst lokales Datum `DD.MM. HH:MM`, Europe/Vienna).
  - Wenn `null` (noch nie gelaufen) → graues Badge „noch nicht gelaufen".
- Jeweils zugeordnet:
  - Tag-Tab → `scheduler_daily`
  - Woche-Tab → `scheduler_weekly`
  - Monat-Tab → `scheduler_monthly`
  - (Match-Today bleibt in `PatternRecallBlock`, dort schon umgesetzt.)

### B) Platz-Optimierung (Whitespace eliminieren)

- Leerer Placeholder-Block (`!analysis && !isAnalyzing` mit großem Brain-Icon und „Wähle einen Zeitraum-Tab…") **entfernen** — die Tabs sind selbsterklärend, der Block füllt nur Höhe.
- `CardHeader` enger: `pb-3` und `CardDescription` kürzen auf eine Zeile oder entfernen (Titel reicht).
- `CardContent space-y-4` → `space-y-3`.
- `AutomationBox`: `p-3 space-y-3` → `p-2.5 space-y-2`, Beschreibung als `text-[11px]` (kleiner), Switch-Zeile kompakter (`text-xs` Label statt `text-sm`).
- TabsContent `mt-4` → `mt-3`, `space-y-3` → `space-y-2`.
- Datenpflege-Collapsible-Trigger: padding `py-2` → `py-1.5`.
- Analyse-Ergebnis-Block bleibt voll sichtbar (kein Trim).

### C) Self-contained: in `Datenpflege`-Box zusätzlich kleinen Status

Über dem Backfill-Button eine Zeile: `Letzter Daily-Score-Lauf: …` aus `scheduler_daily` (gleiche Quelle), damit Entwickler sehen ob Backfill nötig ist.

## Out of scope

- Keine Änderungen am `analysis-scheduler` oder an `PatternRecallBlock` (dort ist „zuletzt: HH:MM" bereits gezeigt).
- Keine neue Tabelle, kein neuer Cron.
- Keine Funktions-Logik-Änderungen.
