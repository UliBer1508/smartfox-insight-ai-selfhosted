## Analyse: Was tut die KI heute – und was fehlt?

### IST-Zustand

| Analyse-Typ | Was es tut | Persistenz | Wirkung auf Steuerung |
|---|---|---|---|
| `daily_pattern` | Freitext | ❌ | ❌ |
| `weekly_comparison` | Strukturiert (trend, self_consumption_ratio, top_grid_import_hours) | ✅ `system_settings.weekly_insight` | ✅ Pre-Heat-Bonus + Efficiency-Throttle |
| `optimize_decision` | Snapshot + Preheat-Signal | ✅ `preheating_signal` | ✅ Pre-Heat-Slot |
| `learned_policies` | Pro (room, hour) Setpoint | ✅ Tabelle | ✅ Hinweis |

### Lücken gegenüber „PV-Ausnutzung optimieren"

1. Keine **Tages-Signatur** (Wetter × PV-Bucket × Temp × Wochentag).
2. Kein **Erfolgs-KPI pro Tag** (Eigenverbrauchsquote, PV-Heiz-Anteil).
3. Kein **Best/Worst-Vergleich** mit zugehörigen Settings.
4. Keine **Wiederanwendung** historischer Sieger-Settings.
5. Keine **Monatsanalyse**, keine **automatische Ausführung** der Tages-/Wochenanalyse.
6. **RPC-Bugs**: `get_weekly_energy_summary` liefert `energy_in_kwh = 0` und `avg_outdoor_c = NULL`.

---

## Lösungskonzept

### 1. RPC-Fixes (Voraussetzung)

`get_weekly_energy_summary` reparieren:
- `energy_in_kwh / energy_out_kwh` aus `hourly_aggregates` summieren (Zähler-Reset-sicher), zusätzlich `feed_in_kwh`.
- Weather-Join Zeitzonen-Fenster fixen → `avg_outdoor_c` befüllt.

### 2. Tages-Signatur + Score (neue Tabelle `daily_pattern_scores`)

```text
date                        PRIMARY KEY
sig_weather                 sunny | mixed | cloudy
sig_pv_bucket               low | mid | high      (expected_kwh: <30 / 30-60 / >60)
sig_temp_bucket             cold | mild | warm    (<5 / 5-15 / >15 °C)
sig_weekday                 workday | weekend
kpi_self_consumption_ratio  (pv_kwh − feed_in)/pv_kwh
kpi_pv_heating_coverage     heating_kwh_während_export / heating_kwh_total
kpi_grid_import_kwh
kpi_battery_end_soc
score                       0..100
settings_snapshot           jsonb (room targets, heating_min_battery_soc, …)
rank_in_signature           Top-N pro Signatur
```

### 3. Pattern-Matcher: bucket-exact + 3/4-Fallback

RPC `match_today_pattern(today_signature jsonb, top_n int) → daily_pattern_scores[]`
- **A bucket-exact**: alle 4 Dimensionen gleich → Top-N nach `score DESC`.
- **B 3-von-4**: wenn A < N, fülle mit 3-Match auf.
- **C weak**: wenn leer, Top-N nach gleichem `sig_pv_bucket` (PV ist wichtigste Dimension).
- Rückgabe enthält `match_quality: exact | partial | weak`.

### 4. Automatik – Settings DIREKT IN DEN KARTEN

Die Cron-Parameter werden **nicht im globalen Settings-Panel**, sondern **inline in der jeweiligen Karte** bearbeitbar:

**Karte „KI-Musteranalyse" (`AnalysisPanel`)** bekommt drei Tab-Karten *Tag / Woche / Monat*; jede Karte zeigt einen kleinen Zahnrad-Bereich „Automatik" mit:
- Toggle „Automatisch ausführen"
- Zeit-Picker (Tagesanalyse), Wochentag+Zeit (Wochen), Tag-des-Monats+Zeit (Monat)
- Manueller „Jetzt ausführen"-Button
- letzter Lauf + nächster geplanter Lauf

**Karte „Heizungsoptimierung" (`HeatingDashboard` / `LearningProgress`)** bekommt einen Inline-Bereich „Pattern-Recall":
- Toggle „Best-Match heute übernehmen"
- Zeit-Picker für `match_today` (Default 05:30, vor Tagesstart)
- Stärke-Slider „Wie stark Sieger-Settings übernehmen" (0–100 %)
- Anzeige der aktuell übernommenen Overrides + Match-Quality-Badge

Persistenz dieser Felder als neue Spalten in `heating_settings`:

```text
analysis_daily_enabled        bool   default true
analysis_daily_time           time   default '03:30'
analysis_weekly_enabled       bool   default true
analysis_weekly_weekday       int    default 0      (0 = So)
analysis_weekly_time          time   default '04:00'
analysis_monthly_enabled      bool   default true
analysis_monthly_dom          int    default 1
analysis_monthly_time         time   default '04:30'
analysis_match_today_enabled  bool   default true
analysis_match_today_time     time   default '05:30'
pattern_recall_strength       int    default 50     (% Bonus-Übernahme)
```

### 5. Scheduler

Eine schlanke Edge-Function **`analysis-scheduler`** wird via pg_cron alle 15 min getriggert, liest die Settings und entscheidet pro Job ob heute fällig → triggert
- `compute-daily-score` (gestriger Tag)
- `analyze-patterns?type=match_today` (schreibt `system_settings.best_match_today`)
- `analyze-patterns?type=weekly_comparison` (Sonntag)
- `analyze-patterns?type=monthly_pattern` (1. des Monats, schreibt `monthly_playbook`)

So sind Zeit/Wochentag/Tag-des-Monats UI-änderbar ohne `cron.schedule` neu zu bauen.

### 6. Konsum in `pv-automation`

Liest zusätzlich `best_match_today` (TTL 24 h):
- `match_quality = exact|partial`: Komfort-Bonus skaliert mit `pattern_recall_strength`; `pre_heat_window` bevorzugt aus Sieger-Tag.
- `weak`/leer: Verhalten unverändert.
- Sticky-Eco / SOC-Hard-Lock / Priorities bleiben **finaler Filter**.

### 7. Wochen- + Monatsanalyse erweitern

- **Weekly**: zusätzlich `best_day`, `worst_day` mit Signatur und Settings-Diff.
- **Monthly** (`type='monthly_pattern'`): aggregiert Scores nach Signatur über 30 d → `system_settings.monthly_playbook = [{ signature, recommended_overrides, sample_size, avg_score }]`. Soft-Skip wenn < 21 Score-Tage.

### 8. UI-Inhalt der Karten

`AnalysisPanel` Tabs:
- **Tag**: heutige Signatur + Top-3 ähnlichste historische Tage (Score, Δ Eigenverbrauch, Match-Quality-Badge, übernommene Overrides) **+** Automatik-Inline-Settings.
- **Woche**: Insight + Best/Worst-Tag-Karte **+** Automatik-Inline-Settings.
- **Monat**: Playbook-Tabelle **+** Automatik-Inline-Settings.

`HeatingDashboard`/`LearningProgress`: Pattern-Recall-Inline-Settings + aktuelle Auswirkung.

---

## Reihenfolge der Umsetzung

1. **Migration**: RPC-Fixes, Tabelle `daily_pattern_scores`, neue `heating_settings`-Spalten, RPC `match_today_pattern`.
2. **Edge-Function** `compute-daily-score` (+ Backfill 30 d).
3. **Edge-Function** `analysis-scheduler` (15-min pg_cron, dispatcht je Settings).
4. **`analyze-patterns`** erweitern: `type='match_today'`, `type='monthly_pattern'`, Wochen-Insight um best/worst.
5. **`pv-automation`** liest `best_match_today` mit `pattern_recall_strength`.
6. **UI**: `AnalysisPanel` Tabs Tag/Woche/Monat mit Inline-Automatik; Pattern-Recall-Box in Heizungs-Karte.
7. **Memory**: `mem://features/heating/pattern-recall`, `mem://features/heating/analysis-scheduler`.
