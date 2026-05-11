
# Jahres-Trendgrafik für Eigenverbrauch (Woche & Monat)

## Ziel

Zusätzlich zur bestehenden Tag/Woche/Monat-Auswertung eine **Langzeit-Trendgrafik** in der Karte „KI-Musteranalyse", die zeigt, wie sich der Eigenverbrauch (SCR) **wöchentlich und monatlich über das gesamte Jahr** entwickelt – sichtbar machen, ob die ML/PV-Optimierung Richtung 100 % wirkt.

## Datengrundlage

`daily_pattern_scores` (vorhanden, durch Backfill bis 365 Tage befüllbar):
- `date`, `kpi_self_consumption_ratio`, `kpi_pv_heating_coverage`, `kpi_grid_import_kwh`, `score`, `pv_kwh`

Aggregation client-seitig:
- **Wöchentlich** (ISO-Woche, Mo–So): Ø SCR, Ø Coverage, Σ PV-kWh, Σ Netzbezug
- **Monatlich**: gleiche Aggregate
- **Trendlinie**: lineare Regression über die Aggregat-Punkte → Steigung in pp/Monat als KPI

## UI-Layout

Neuer Block **unterhalb** des bestehenden Cockpits, vor den Tab-spezifischen Inhalten oder als eigener „Jahr"-Tab. Empfehlung: **eigener 4. Tab „Jahr"** in derselben Tab-Leiste (Tag · Woche · Monat · **Jahr**), damit die bestehenden Tabs unverändert kompakt bleiben.

```text
┌─ Jahr ──────────────────────────────────────────────┐
│ Granularität: ( ) Woche  (•) Monat   Range: 12M ▾  │
├─────────────────────────────────────────────────────┤
│  100% ┤ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Ziel             │
│   80% ┤              ▂▃▄▅▆▆▇       ← Trend +1.2pp/M│
│   60% ┤      ▁▂▃▃▄▄                                │
│   40% ┤▁▂▂                                         │
│   20% ┤                                            │
│       └────────────────────────────────────────────│
│        Jan  Feb  Mär  Apr  Mai  ...                │
│                                                     │
│  KPI-Strip:                                        │
│  Bestmonat: Mai 84%   Schlechtester: Jan 38%       │
│  Trend: +1.2 pp / Monat   Δ Jahr: +18 pp           │
│  Σ PV: 14.2 MWh   Σ Netzbezug: 1.8 MWh             │
└─────────────────────────────────────────────────────┘
```

Charts via **Recharts** (bereits im Projekt): `ComposedChart` mit:
- **Bar** = SCR pro Woche/Monat (Hauptserie)
- **Line** = 4-Perioden gleitender Mittelwert
- **ReferenceLine** = lineare Regression (Trendlinie)
- **ReferenceLine** = 100 % Ziel (gestrichelt)

Tooltip pro Punkt: Periode, SCR %, PV kWh, Netzbezug kWh, Score.

## Komponenten (neu)

1. **`YearTrendChart.tsx`** (`src/components/energy/stats/`)
   - Props: `granularity: 'week' | 'month'`, `monthsBack: number` (Default 12)
   - Liest direkt aus `daily_pattern_scores` für die letzten N Monate
   - Aggregiert lokal (ISO-Woche oder Monat in `Europe/Vienna`)
   - Berechnet lineare Regression + Δ Jahr
2. **`useYearlyStats.ts`** (Hook)
   - Lädt Tagesdaten ≤365 Tage zurück
   - Liefert beide Aggregate (Woche + Monat) gecached
3. Integration: neuer Tab **„Jahr"** in `AnalysisPanel.tsx` mit Granularitäts-Toggle (Switch/RadioGroup) und Range-Select (3M / 6M / 12M).

## KPIs im Trend-Block

- Trend-Steigung **pp/Monat** (positiv = Verbesserung)
- Δ vom ersten zum letzten Punkt der Range (in pp)
- Bestperiode + Wert
- Schlechteste Periode + Wert
- Σ PV kWh / Σ Netzbezug kWh über Range

## KI-Erweiterung (optional, klein)

`analysis-summary` Edge Function um `range: 'year'` ergänzen → liefert Klartext-Bewertung des Jahresverlaufs („Ø-Verbesserung +1,2 pp/Monat, Sommer-Plateau ab Juni, Winter-Schwäche Dez–Jan ist erwartbar"). Cached in `system_settings.analysis_summary_year`.

## Out of Scope

- Keine Schema-Änderung
- Kein Touch an `pv-automation` oder Eco/Komfort-Logik
- Kein Vergleich mehrerer Jahre (nur rollierende 12 Monate)
- Cockpit-Komponente bleibt unverändert

## Lieferumfang

- 1 neue Hook (`useYearlyStats`)
- 1 neue Komponente (`YearTrendChart`)
- 1 neuer Tab in `AnalysisPanel`
- Erweiterung `analysis-summary` um `range: 'year'`
- Memory-Update: `mem://features/analysis/year-trend`

## Voraussetzung

`daily_pattern_scores` muss historisch gefüllt sein. Aktuell sind 30 Tage da → User sollte nochmal **Backfill 90 Tage** (oder mehr, max sinnvoll: 365) ausführen, sobald genug Quelldaten vorliegen. UI zeigt Hinweis falls <8 Wochen Daten vorhanden.
