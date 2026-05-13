## Ziel

Die KI soll schrittweise Verantwortung für **dynamische Steuerparameter** übernehmen — aber zunächst nur als **Schatten-Entscheider** (Shadow Mode). Sie schlägt Werte vor und dokumentiert Begründungen, ändert aber **nichts selbst**. Erst nach Auswertung der Logs entscheiden wir pro Parameter, ob die KI Schreibrechte bekommt.

## Phase 1 — Parameter-Whitelist definieren

Wir legen fest, welche Parameter die KI überhaupt anfassen darf. Vorschlag (aus den heutigen Painpoints abgeleitet):

| Kategorie | Parameter | Quelle | Heutiges Verhalten |
|---|---|---|---|
| Komfort-Sättigung | `comfort_saturation_override_enabled` (neu) | `system_settings` | hardcoded Battery-Full-Override |
| Komfort-Sättigung | Override-Schwellen: `soc_min`, `grid_export_min`, `forecast_min_kwh` (neu) | `system_settings` | hardcoded 95 / 3000 / 5 |
| Budget | `parallel_heating_capacity` | `system_settings` | manuell |
| Budget | `baseload_buffer_w` (neu, falls separat) | `system_settings` | hardcoded |
| Pre-Heat | `pattern_recall_strength` | `heating_settings` | manuell, 0–100 |
| SOC-Gate | `heating_min_battery_soc` | `heating_settings` | manuell |
| Nacht | `night_heating_mode` (`frost_only` / `maintain`) | `heating_settings` | manuell |
| Pro Raum | `pv_boost_max_temp`, `eco_temp`, `comfort_temp` | `rooms` | manuell |

**Bewusst ausgeschlossen** (zu sicherheitsrelevant): `night_temp` (Frostschutz), `night_start_time`/`night_end_time`, `tuya_device_id`, alle Hardware-Felder.

→ **Entscheidungspunkt:** Ist diese Liste vollständig / korrekt? Streichungen, Ergänzungen?

## Phase 2 — Schema für KI-Entscheidungs-Log

Neue Tabelle `ai_parameter_decisions`:

- `decision_id`, `created_at`
- `parameter_scope` (`global` | `room`) + `room_id` (nullable)
- `parameter_key` (aus Whitelist)
- `current_value`, `proposed_value`
- `reasoning` (Volltext, von Gemini)
- `confidence` (0–1)
- `context_snapshot` (jsonb: SOC, Export, Forecast, Innentemps, Wetter)
- `expected_outcome` (jsonb: prognostizierter SCR, kWh-Eigenverbrauch, Komfortminuten)
- `decision_mode` (`shadow` | `applied`) — startet immer auf `shadow`
- `applied_at`, `applied_by` (nullable)
- `outcome_evaluated_at`, `actual_outcome` (jsonb), `outcome_score` (numeric, nullable)

Dazu Tabelle `ai_parameter_whitelist`:
- `parameter_key`, `scope`, `min_value`, `max_value`, `allowed_values` (jsonb)
- `autonomy_level` (`shadow` | `suggest` | `auto`) — initial alle `shadow`
- `enabled`, `notes`

→ Whitelist ist **DB-getrieben**, nicht im Code — so können wir später pro Parameter freigeben, ohne Deploy.

## Phase 3 — Edge-Function `ai-parameter-advisor`

Neue Function, läuft per pg_cron alle 15 min (oder bei großen Events: SOC>95, Export>5kW, Forecast-Update).

Ablauf:
1. Lädt aktuellen System-Snapshot (SOC, Export, PV, Innentemps pro Raum, Forecast, letzte 24h KPIs aus `daily_pattern_scores`).
2. Lädt aktive Whitelist-Parameter.
3. Schickt strukturierten Prompt an Gemini mit:
   - Ist-Zustand
   - Erlaubte Parameter + Range
   - Letzte 7 Tage `daily_pattern_scores`
   - Letzte eigene `ai_parameter_decisions` (Lerneffekt)
4. Erwartet **strukturierten JSON-Output** (Schema-validiert):
   ```
   { decisions: [{ parameter_key, scope, room_id?, proposed_value, reasoning, confidence, expected_outcome }] }
   ```
5. Schreibt jede Entscheidung in `ai_parameter_decisions` mit `decision_mode='shadow'`.
6. **Schreibt KEINE realen Settings** in dieser Phase.

Rate-Limit-Schutz: max. 1 Aufruf / 15 min, bei Gemini-429 → next-run skip + Log.

## Phase 4 — Outcome-Tracking

Cron 1×/Tag (z.B. 03:00, nach `daily_pattern_scores`):
- Für jede shadow-Decision der letzten 24h: vergleiche `expected_outcome` vs. tatsächlich (SCR, kWh, Komfortminuten aus den schon vorhandenen KPIs).
- Schreibe `actual_outcome` + `outcome_score` (−1 bis +1).

→ Damit haben wir nach ~14 Tagen eine **echte Treffer-Statistik** pro Parameter.

## Phase 5 — UI: „KI-Vorschläge & Schatten-Entscheidungen"

Neuer Tab in der KI-Musteranalyse-Seite (oder in Settings):
- Tabelle: letzte 50 Shadow-Decisions
- Spalten: Zeitstempel, Parameter, Vorgeschlagen, Begründung (expandable), Confidence, Outcome-Score (wenn evaluiert)
- Filter: nur unevaluierte / nur hohe Confidence / pro Parameter
- Aggregations-Header pro Parameter: Avg Outcome-Score, Hit-Rate, Anzahl Entscheidungen
- **Kein Apply-Button** in dieser Phase.

## Phase 6 — Freigabe-Mechanismus (später, nach Auswertung)

Pro Parameter in `ai_parameter_whitelist` umschalten:
- `shadow` → `suggest`: UI zeigt Apply-Button, Mensch bestätigt
- `suggest` → `auto`: KI darf direkt schreiben (mit Audit-Log + Rollback-Fenster 1h)

→ Diese Phase ist **nicht Teil dieses Plans** — kommt erst nach 2–4 Wochen Daten.

## Out of Scope

- Keine Änderung an `pv-automation` Budget-Logik
- Keine Änderung an `analyze-patterns` (bleibt für Heizpläne zuständig)
- Keine ML-/Reward-Integration in dieser Phase (Outcome-Score reicht)
- Keine automatische Parameter-Änderung — strikt Shadow

## Technische Skizze

```text
┌──────────────────┐    ┌──────────────────────┐    ┌─────────────────────────┐
│ pg_cron 15min    │ -> │ ai-parameter-advisor │ -> │ ai_parameter_decisions  │
└──────────────────┘    │ (Gemini, JSON-Schema)│    │ (mode='shadow')         │
                        └──────────────────────┘    └─────────────────────────┘
                                                              │
┌──────────────────┐    ┌──────────────────────┐              │
│ pg_cron daily    │ -> │ outcome-evaluator    │  ────────────┘
└──────────────────┘    └──────────────────────┘

UI (read-only) <── ai_parameter_decisions + ai_parameter_whitelist
```

## Offene Fragen

1. **Parameter-Liste** (Tabelle oben) — passt das, oder andere Auswahl?
2. **Frequenz** — alle 15 min oder lieber event-getrieben (SOC-Sprung, Export-Spitze)?
3. **UI-Ort** — neuer Tab in „KI-Musteranalyse" oder eigene Seite „KI-Entscheidungen"?
