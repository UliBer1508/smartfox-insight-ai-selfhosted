## Ziel

Zwei sichtbare „Zuletzt aktualisiert"-Badges mit relativer Zeit (z. B. „vor 3 h") und Frische-Ampel (frisch=grün, veraltet=amber, fehlt=grau):

1. **KI-Zusammenfassung** (in `ProgressCockpit.tsx`) — zeigt Alter von `data.generated_at`
2. **Tagesmuster-Block** (in `AnalysisPanel.tsx`) — bestehender Badge wird auf gleiche Logik umgestellt

## Umsetzung

### 1. Neue gemeinsame Komponente `src/components/ui/LastUpdatedBadge.tsx`

- Props: `iso: string | null | undefined`, `staleAfterMs: number`, optional `label` (default `"Zuletzt"`)
- Format **relativ** in Deutsch: „gerade eben" (<60 s), „vor X min" (<60 min), „vor X h" (<24 h), „gestern HH:MM", „vor X Tagen", danach absolutes Datum
- Auto-Refresh per `setInterval` (60 s), damit „vor 3 h" live tickt
- Tooltip mit exaktem Wiener Zeitstempel (`Intl.DateTimeFormat` mit `Europe/Vienna`)
- Farb-Logik:
  - **grau** (`bg-muted/40 text-muted-foreground`) — kein Zeitstempel
  - **grün** (`bg-emerald-50 text-emerald-700 …`) — Alter ≤ `staleAfterMs`
  - **amber** (`bg-amber-50 text-amber-700 border-amber-300 …`) — älter als Schwelle
- Icon: `Clock` (frisch/leer) bzw. `AlertCircle` (stale) aus lucide-react

### 2. `src/components/energy/stats/ProgressCockpit.tsx`

- Import `LastUpdatedBadge` + `STALE_MS` aus `useAnalysisSummary` (export hinzufügen)
- Badge in der Header-Zeile der KI-Zusammenfassungs-Karte links neben dem „Text neu erzeugen"-Button platzieren
- `staleAfterMs = STALE_MS[range]` (24 h / 7 d / 30 d)
- Untere „Stand: … · aktualisiert sich automatisch"-Zeile entfernen (redundant zum Badge)

### 3. `src/components/energy/AnalysisPanel.tsx`

- Lokale `LastRunBadge` durch neue `LastUpdatedBadge` ersetzen (beide Vorkommen: Header + Tagesmuster-Block)
- `staleAfterMs`: 26 h für Tages-Scheduler (kleiner Puffer über 24 h), entsprechende Werte für weekly/monthly an deren Stellen
- `formatLastRun` lokal löschen (ersetzt durch Badge-interne Formatierung); bestehende Imports (`CheckCircle2`) aufräumen, falls ungenutzt

## Nicht-Ziele

- Keine Änderungen an Edge Functions, Scheduler, DB oder Hook-Logik
- Keine neuen Tabellen, Migrationen, Settings
- Reine UI-/Präsentations-Arbeit

## Risiken

- Minimal. Auto-Refresh-Interval wird in `useEffect` mit Cleanup gestartet, kein Leak.
