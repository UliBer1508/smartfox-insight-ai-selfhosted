
# KI-Musteranalyse: Fortschritt Richtung 100 % PV-Eigenverbrauch

## Ziel

Die Karte „KI-Musteranalyse" wird vom reinen Trigger-Panel zu einem **Fortschritts-Cockpit**. Für jede Analyseebene (Tag / Woche / Monat / Match) gibt es:
1. Eine **kurze KI-Zusammenfassung** in Klartext (3–5 Sätze).
2. Eine **statistische Anzeige**, wie nah wir an 100 % PV-Eigenverbrauch sind.
3. Einen **Trend** (Verlauf über Zeit), damit Lerneffekt sichtbar wird.

Die Backend-Daten dafür liegen bereits vor in `daily_pattern_scores` (kpi_self_consumption_ratio, kpi_pv_heating_coverage, kpi_grid_import_kwh, score) und `learning_events`.

## Leitkennzahl

**Self-Consumption-Ratio (SCR)** = `self_consumption_kwh / pv_kwh` (0–100 %).
Sekundärkennzahlen:
- **PV-Heating-Coverage** = Anteil Heizenergie aus PV
- **Grid-Import (kWh)** – soll Richtung 0 fallen
- **Daily Score** (0–100) – Gesamtnote
- **ML-Lernfortschritt** = Anzahl `learning_events` mit positiver Reward-Tendenz, gleitender Mittelwert

## UI-Layout pro Tab (Tag / Woche / Monat)

```text
┌─ KI-Musteranalyse ─────────────────────────────────────┐
│ [Tag] [Woche] [Monat] [Match heute]                    │
├────────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────────────────────────┐ │
│ │  84 %        │  │  Trend (30 Tage)                 │ │
│ │  Eigen-      │  │  ▁▂▂▃▄▄▅▆▆▇▇  +12 % vs. Vorper. │ │
│ │  verbrauch   │  │                                  │ │
│ │  ▲ +6 %      │  │  Ø 78 %  Best 96 %  Schlecht 41 %│ │
│ └──────────────┘  └──────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐
│ │ Fortschritt zu 100 %:  [██████████░░░] 84 %         │
│ │ Heizung aus PV: 71 %   Netzbezug: 3,2 kWh           │
│ │ Score: 82 / 100        ML-Konfidenz: 0.74           │
│ └──────────────────────────────────────────────────────┘
│ ┌─ Zusammenfassung (KI) ──────────────────────────────┐ │
│ │ „Heute 84 % Eigenverbrauch – bester Wert seit 9 Tg. │ │
│ │  Komfort-Bonus 320 W aus Pattern-Recall hat sich    │ │
│ │  ausgezahlt. Verlust-Treiber: Netzbezug 18:00–20:00 │ │
│ │  (Akku leer). Empfehlung: Vorheizen bis 17:00."     │ │
│ └─────────────────────────────────────────────────────┘ │
│ ▸ Automatik (collapsible, wie heute)                   │
│ ▸ Manuell ausführen                                    │
└────────────────────────────────────────────────────────┘
```

## Inhalte pro Ebene

| Ebene | Datenfenster | Hauptchart | Zusammenfassung |
|---|---|---|---|
| **Tag** | letzte 24 h + Vergleich Vortag | Stundenbalken SCR | „Was lief gut/schlecht heute, welche Stunde war Verlust-Treiber" |
| **Woche** | 7 Tage | Tagesbalken SCR + Linie Score | „Welcher Wochentag/Wetterbucket performt am besten" |
| **Monat** | 30 Tage | Linie SCR + 7-Tage-MA | „Trend Verbesserung in %, beste/schlechteste Tage, Wirkung der ML-Settings" |
| **Match heute** | aktuelles Signature-Bucket | Vergleich heute vs. bester historischer Tag mit gleicher Signatur | „Heute ähnelt 04.05. (Score 100). Erwarteter Endwert: 92 %. Pattern-Recall aktiv." |

## Statistik-Komponenten (neu)

1. **`SelfConsumptionGauge`** – großer Prozentwert + Delta vs. Vorperiode (▲/▼).
2. **`ProgressTo100Bar`** – horizontale Fortschrittsleiste mit Markern (Ø, Best, Ziel 100 %).
3. **`TrendSparkline`** – kompakter Verlauf der letzten N Perioden, eingefärbt nach Richtung.
4. **`KpiGrid`** – 4 kleine Kacheln: SCR, Heizung-aus-PV, Netzbezug, Score.
5. **`AISummaryCard`** – Klartext aus Gemini, max. 5 Sätze, mit Reload-Button.
6. **`MLProgressIndicator`** – „ML-Lernkurve": Reward-Mittelwert letzte 7 vs. vorige 7 Tage, Konfidenz-Badge.

Alle nutzen Design-Tokens (`--primary`, `--muted`, etc.), keine harten Farben.

## Datenbeschaffung

- **Read-only** aus `daily_pattern_scores` (bereits gefüllt durch Backfill).
- Aggregation client-seitig in einem neuen Hook **`useSelfConsumptionStats(range: 'day'|'week'|'month')`**.
- KI-Zusammenfassung: bestehende Edge Function `analyze-patterns` erweitern um Response-Feld `summary_text` (3–5 Sätze, Gemini), gespeichert in `system_settings` Key `analysis_summary_<type>` mit Timestamp → UI zeigt Cache + „Neu generieren"-Button.

## Backend-Anpassungen (minimal)

1. **`analyze-patterns/index.ts`**: Bei jedem Lauf zusätzlich Klartext-Summary erzeugen (Gemini, deutsch, max. 5 Sätze) und in `system_settings` ablegen.
2. **Kein Schema-Change** – alle Werte existieren in `daily_pattern_scores` und `learning_events`.

## Frontend-Änderungen

- `src/components/energy/AnalysisPanel.tsx`: Tab-Inhalte um Stats-Block + Summary-Block erweitern (vor „Automatik"-Box).
- `src/hooks/useSelfConsumptionStats.ts` (neu): lädt + aggregiert.
- `src/components/energy/stats/` (neu): die 6 Komponenten oben.

## Out of Scope

- Keine Änderung an `pv-automation`, Eco/Komfort-Logik, Sticky-Eco, SOC-Gates.
- Keine neuen Tabellen, keine Migration.
- Pattern-Recall-Block in der Heizungs-Karte bleibt unverändert (zeigt weiterhin Match-Strength + Slider).

## Lieferumfang

- 1 erweiterte Edge Function (Summary), 1 Hook, 6 kleine Stats-Komponenten, Integration in 4 Tabs.
- Memory-Update: `mem://features/analysis/progress-cockpit`.
