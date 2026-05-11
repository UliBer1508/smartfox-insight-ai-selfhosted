## Ziel

Nächste Ausbau-Schritte umsetzen:
1. **`pv-automation`**: nutzt `best_match_today` zusätzlich zu `weekly_insight` (Komfort-Bonus + Pre-Heat-Fenster, skaliert mit `pattern_recall_strength`).
2. **UI**: Inline-Automatik-Einstellungen + Tag/Woche/Monat-Tabs in beiden Karten.

---

## 1) `pv-automation` — Pattern-Recall-Integration

In `supabase/functions/pv-automation/index.ts` direkt nach dem `weekly_insight`-Block (~Zeile 1866):

- Lese `system_settings.best_match_today` (TTL 24h).
- Lese `heating_settings.pattern_recall_strength` (0–100, Default 50).
- Match-Quality-Logik:
  - `exact` → Bonus = 100 % der Stärke
  - `partial` → Bonus = 60 % der Stärke
  - `weak`/leer → kein Effekt
- Effekt:
  - **Komfort-Budget-Bonus**: `comfortBudget += round(strength% × 400W × qualityFactor)` (max +400 W).
  - **Pre-Heat-Fenster aus Winner-Tag**: falls Winner gute `kpi_pv_heating_coverage` hatte und aktuelle Stunde im Winner-Heizfenster liegt → `availableBudget = max(availableBudget, 600W)`.
- Logging mit `[PATTERN-RECALL]` Präfix für Nachvollziehbarkeit.
- Schreibe `pattern_recall_applied` in den `learning_events.action`-Block (Audit).

Sticky-Eco/SOC-Gate/Battery-Bonus bleiben unverändert — Pattern-Recall ist nur ein zusätzlicher Modifier.

---

## 2) UI — Inline-Automatik in den beiden Karten

### 2a) Karte „KI-Musteranalyse" (`src/components/energy/AnalysisPanel.tsx`)

Innerhalb der Card neue Tabs **Tag / Woche / Monat**. Jeder Tab:

- Manueller Trigger-Button (bestehend für Tag/Woche, neu für Monat → ruft `analyze-patterns?type=monthly_pattern`).
- **Automatik-Box** (kollabierbar, kompakt):
  - Toggle „Automatisch ausführen"
  - Tag-Tab: Time-Picker (`analysis_daily_time`)
  - Woche-Tab: Wochentag-Select + Time-Picker (`analysis_weekly_weekday`, `analysis_weekly_time`)
  - Monat-Tab: Tag-des-Monats-Number (1–28) + Time-Picker (`analysis_monthly_dom`, `analysis_monthly_time`)
  - „Letzte/Nächste Ausführung" Anzeige (aus `system_settings.last_*_run`)
  - Speicher-Button → `useHeatingSettings.saveSettings({...})`
- Zusätzlich oben in der Card: **Backfill-Block** (Tage-Auswahl 7/30/90 + Button → `compute-daily-score` mit `{backfill: N}`).

Component erhält `settings`/`saveSettings` als Props (oder ruft `useHeatingSettings` direkt).

### 2b) Karte „Heizungs-Optimierung" (`src/pages/Index.tsx` Zeilen 299–446)

Im `learning`-Tab **oben** ein neuer **Pattern-Recall-Block**:
- Toggle „Pattern-Recall aktiv" (`analysis_match_today_enabled`)
- Time-Picker für tägliches Matching (`analysis_match_today_time`)
- Slider „Stärke" 0–100 (`pattern_recall_strength`)
- Badge mit aktueller Match-Quality (lesen aus `system_settings.best_match_today.match_quality`) + Datum des Winners
- Button „Jetzt matchen" → ruft `analyze-patterns` mit `{type: 'match_today'}`
- Speicher-Button

Karte sonst unverändert.

### 2c) Hook-Update

`src/hooks/useHeatingSettings.ts`: defaults erweitern um die 11 neuen Felder (Werte aus Migration). Typ `HeatingSettings` in `src/types/heating.ts` ebenfalls erweitern.

---

## Technische Details

- **Backfill-Tage-Auswahl**: 7/30/90 fix (keine freie Eingabe).
- **Time-Picker**: `<Input type="time">` (shadcn-kompatibel).
- **Wochentag-Select**: 0=So…6=Sa.
- **`last_run`/`next_run`**: `analysis-scheduler` schreibt `system_settings.last_<job>_run` nach jedem Lauf — UI zeigt das nur an (read-only). Falls Feld noch nicht existiert: später als kleines Backend-Patch nachziehen, UI-seitig erstmal leer-tolerant rendern.
- **Polling**: Match-Quality-Badge per 60s-Intervall aus `system_settings.best_match_today` lesen (analog zu bestehendem Polling-Pattern).

---

## Geänderte Dateien

- `supabase/functions/pv-automation/index.ts` (Pattern-Recall-Block einfügen)
- `src/types/heating.ts` (11 neue optionale Felder)
- `src/hooks/useHeatingSettings.ts` (Defaults erweitern)
- `src/components/energy/AnalysisPanel.tsx` (Tabs + Automatik + Backfill)
- `src/pages/Index.tsx` (Pattern-Recall-Block im learning-Tab)

---

## Memory-Updates nach Build

- `mem://features/heating/pattern-recall` — Recall-Logik & Strength-Skalierung
- `mem://features/heating/analysis-scheduler` — Cron + UI-Inline-Settings
- Index-Update unter „Machine Learning"

---

## Out of Scope

- Kein neuer Settings-Panel-Tab (du wolltest explizit Inline in den Karten).
- Kein Anpassen der bestehenden Eco-/Komfort-/Sticky-Logik.
