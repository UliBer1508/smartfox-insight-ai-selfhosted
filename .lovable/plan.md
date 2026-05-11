## Ursachenanalyse

**Befund:** `daily_patterns` enthält als jüngsten Eintrag den **17.02.2026** (heute: 11.05.2026). Der Wochenvergleichs-Hook (`usePatternAnalysis.analyzeWeeklyComparison`) liest stur die letzten 7 Zeilen aus dieser Tabelle und schickt sie als „Wochendaten" an die KI → daher analysiert sie Februar.

**Drei zusammenhängende Bugs:**

1. **Daily-Aggregator schreibt nur historische Tage.**  
   `aggregate-energy-data` erzeugt `daily_patterns` ausschließlich aus `hourly_aggregates`, die **älter als `hourly_retention_days` (Default 90 Tage)** sind (Step 2, Zeile 117–171). Heute − 90 Tage ≈ 10.02. → genau der vorhandene Datenstand. Aktuelle Tage werden nie aggregiert, weil sie noch innerhalb der Retention liegen.

2. **`total_energy_in / total_energy_out` sind durchgehend `0`.**  
   Der Aggregator summiert die `total_energy_*`-Spalten der `hourly_aggregates`, die jedoch beim 1-Minuten-Polling nicht als kWh-Δ pro Stunde befüllt werden (Zählerstände, keine Differenzen). Damit fehlt der KI die wichtigste Wochenkennzahl.

3. **Wochenanalyse-Ergebnis fließt nirgendwohin.**  
   `analyze-patterns` mit `type='weekly_comparison'` gibt nur Text zurück. Es gibt keine Persistenz analog zum `preheating_signal`, daher kann `pv-automation` daraus nichts lernen.

---

## Lösungskonzept

### Schritt 1 — Datenquelle korrigieren (Quick-Win, behebt Februar-Problem)

`useHookPatternAnalysis.analyzeWeeklyComparison` umbauen: statt aus `daily_patterns` aus einer neuen RPC `get_weekly_energy_summary(days_back integer default 7)` lesen, die **on-the-fly aus `energy_readings` + `hourly_aggregates` der letzten 7 Tage** berechnet:
- pro Tag: peak_power, avg_power
- Energie-In/Out aus `energy_readings.energy_in/energy_out` als (max − min) pro Tag (Zählerstand-Differenz, korrekt)
- PV-Ertrag aus `pv_power` integriert
- Heizverbrauch aus `room_heating_logs` joinen
- Außentemperatur-Schnitt aus `weather_data`

Damit ist der Wochenvergleich sofort wieder aktuell und reichhaltiger als heute.

### Schritt 2 — Aggregator entkoppeln (strukturell)

In `aggregate-energy-data` einen neuen Schritt „**daily snapshot for yesterday**" hinzufügen, der unabhängig von `hourly_retention_days` läuft:
- Für `gestern` (Vienna-TZ) `daily_patterns` upserten — auch wenn die Hourly-Daten noch in Retention sind.
- Energie-Felder aus `energy_readings`-Zählerstands-Differenz (max − min am Tag), nicht aus `total_energy_in` der Hourlies.
- Bestehender Step 2 (Konsolidierung beim Löschen) bleibt als Backup.

Cron `aggregate-energy-data-daily` (03:00) läuft bereits — keine zusätzliche Schedule nötig.

### Schritt 3 — Lücke 18.02.–10.05. einmalig auffüllen

Backfill-Aufruf der erweiterten Funktion mit `body: {time:'backfill', days:90}` — schreibt fehlende `daily_patterns` aus vorhandenen `energy_readings`. Einmalig manuell triggern.

### Schritt 4 — ML-/PV-Anbindung

Im `analyze-patterns` Block `type==='weekly_comparison'`:
- Tool-Calling aktivieren mit Schema  
  `{ trend: 'improving|stable|worsening', avg_self_consumption_ratio, top_grid_import_hours, recommendations: [{ key, value, reason }], summary }`
- Ergebnis in `system_settings.weekly_insight` persistieren (analog zum bereits existierenden `preheating_signal`-Pattern, Zeile 339–381).
- `pv-automation` liest `weekly_insight` (TTL 7 Tage) und nutzt z. B.:
  - `top_grid_import_hours` → Pre-Heat-Fenster bevorzugt vor diesen Stunden
  - `avg_self_consumption_ratio < 0.6` → Komfort-Bonus reduzieren (mehr Eco)
  - `trend='worsening'` → Komfort-Sättigung früher auslösen

`AISettingsSuggestions` zeigt die `recommendations` als anwendbare Vorschläge (Whitelist bleibt aktiv, siehe `mem://features/heating/ai-settings-suggestions-hardened`).

### Schritt 5 — UI

`AnalysisPanel` zeigt beim Wochenvergleich Datumsbereich („KW 19, 04.05.–10.05.2026") explizit über der KI-Antwort, damit veraltete Daten sofort auffallen.

---

## Technische Umsetzungsskizze

```text
Migration:
  CREATE FUNCTION get_weekly_energy_summary(days_back int)
    RETURNS TABLE(date, peak_power, avg_power, energy_in_kwh,
                  energy_out_kwh, pv_kwh, heating_kwh, avg_outdoor_c)

Edge:
  aggregate-energy-data
    + Step 0: upsertYesterdayDailyPattern()
    + Branch body.time === 'backfill' → loop days_back

  analyze-patterns (type=weekly_comparison)
    + tool 'weekly_insight'
    + upsert system_settings.weekly_insight

  pv-automation
    + readWeeklyInsight() (TTL 7d)
    + nutzt top_grid_import_hours + self_consumption_ratio

Frontend:
  src/hooks/usePatternAnalysis.ts
    - dailyPatterns-Quelle ersetzen durch RPC
  src/components/energy/AnalysisPanel.tsx
    + Datumsbereich-Header
```

## Auswirkung
- Wochenvergleich zeigt sofort die echte letzte Woche.
- KI bekommt korrekte Energiebilanz statt Nullen.
- ML/`pv-automation` lernt aus Wochen-Trend (echter Closed Loop statt nur Tagesentscheidung).
- Strukturschuld im Aggregator beseitigt — daily_patterns ist nicht mehr an Retention gekoppelt.
