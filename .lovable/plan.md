# Plan: 100% KI-Architektur (Claude-Vorschlag, angepasst an Bestand)

Vorab — drei Punkte, die ich umsetze, aber risikobewusst absichere:

1. **Claude Haiku** bricht die Core-Regel „Direct Google Gemini API". Ich erweitere die Regel auf „Gemini für Taktik/Advisor, Claude Haiku nur für Tagesplaner 1×/Tag" und dokumentiere es im Memory. Neuer Secret `ANTHROPIC_API_KEY` nötig.
2. **3 Parameter sofort auf `auto`** ohne Outcome-Gate ist riskant. Ich baue trotzdem einen **Hard-Safety-Net** ein: Min/Max-Range aus Whitelist + Audit-Log + manueller Kill-Switch (`system_settings.ai_auto_mode_enabled`), den du mit einem Klick auf false setzen kannst.
3. **Prioritätenreihenfolge 1–12** ist laut Memory Core-Regel. Ich überschreibe sie nicht — der KI-Plan liefert **Re-Sortierung *innerhalb gleicher Priorität*** und einen *„dringlichkeits-bonus"* pro Raum, nicht eine neue Reihenfolge.

---

## Woche 1 — Fundament (DB + Secrets)

**DB-Migration** (1 Migration, alle Änderungen zusammen):
- `system_settings`: Seed-Inserts `tuya_cloud_status`, `ai_auto_mode_enabled` (default true, Kill-Switch), `daily_planner_enabled`
- `heating_recommendations`: neue Spalten `ai_source text`, `priority_rank int`, `reasoning text`, `valid_for_date date`
- `room_kpi_15min` (neu): `room_id`, `bucket_start` (15-min), `grid_import_wh`, `pv_used_wh`, `heating_minutes`, `temp_start`, `temp_end`, `target_temp`, `target_reached bool` — RLS: authenticated full, anon read-only
- `ai_parameter_decisions`: Spalte `auto_applied bool default false` + `rollback_at timestamptz`
- Trigger `validate_ai_auto_apply()`: blockiert UPDATE auf `heating_settings` durch service_role wenn neuer Wert außerhalb Whitelist-Range

**Secret:** `ANTHROPIC_API_KEY` via `add_secret`.

**Seed:** `ai_parameter_whitelist` für 3 Pilot-Parameter auf `auto` setzen:
- `pv_surplus_threshold_on` (Range 300–800W)
- `pv_surplus_threshold_off` (Range 100–400W)
- `night_start_time` (Range 21:00–23:00)

## Woche 2 — Tagesplaner Edge Function

**Neu: `supabase/functions/ai-daily-planner/index.ts`** — Claude Haiku via Anthropic API.

Input-Kontext (DB-Reads):
- `pv_forecasts` (heute + morgen, hourly_watts)
- `rooms` aktuelle current_temp/target_temp/priority
- `room_ml_features` (energy_per_degree, heat_loss_rate)
- `weather_data` (next 24h)
- `daily_pattern_scores` letzte 7 Tage (für Lernsignal)
- letzte 5 `daily_heating_plan`-Outcomes

Output → INSERT in `heating_recommendations` mit `ai_source='daily_planner'`, `priority_rank` pro Raum, `reasoning`, `valid_for_date=heute`.

**pg_cron:** täglich 06:00 Europe/Vienna (= 05:00 UTC im Winter, 04:00 UTC im Sommer — ich nutze `'0 5 * * *'` und akzeptiere 1h Sommerzeit-Verschiebung, oder eine pg-Funktion mit TZ-Check).

Fallback: wenn Anthropic-Call fehlschlägt → bestehender Gemini-Pfad als Backup (nicht blockierend).

## Woche 3 — pv-automation Integration + Auto-Mode

**`supabase/functions/pv-automation/index.ts` (~30 Zeilen Änderung):**
- Vor Raum-Iteration: `heating_recommendations WHERE ai_source='daily_planner' AND valid_for_date=today` lesen
- `priority_rank` als **Sekundär-Sortierschlüssel** *innerhalb* der bestehenden Priorität 1–12 anwenden
- Bei fehlendem Plan: bestehende Logik unverändert (kein Breaking Change)
- Audit-Log: jede Raum-Entscheidung mit `ai_plan_used: true/false` in learning_events

**`ai-parameter-advisor` Auto-Mode:**
- Whitelist-Lookup `autonomy_level='auto'` → vor Schreibvorgang: Kill-Switch prüfen (`ai_auto_mode_enabled`), Range-Validierung, Vorgängerwert in `ai_parameter_decisions.current_value` sichern (für Rollback)
- Direkt-UPDATE auf `heating_settings` (nur für die 3 Pilot-Parameter)
- `auto_applied=true`, `applied_at=now()` setzen
- Toast/Notification-Trigger via Realtime → UI zeigt "KI hat X geändert"

## Woche 4 — Dashboard + 15-Min-KPIs

**Frontend:**
- `ControlModeBadge` erweitern: „Cloud deaktiviert" zusätzlich anzeigen wenn `tuya_cloud_status.active=false`. Prominenter im Header platzieren.
- **Neues Widget `DailyAIPlanCard.tsx`** (im `HeatingDashboard` oberhalb von `AIShadowDecisions`): zeigt Prioritäts-Ranking + `reasoning` von Haiku, Refresh-Button (manueller Re-Run)
- **`AIShadowDecisions`** erweitern: Auto-applied Decisions mit grünem Badge + Rollback-Button (24h-Fenster)
- **KPI-Sparkline:** SCR 7-Tage in `HeatingOverviewCard` (Recharts mini-line)

**15-Min-KPI-Cron:**
- Neue Edge Function `compute-room-kpi-15min` — liest letzte 15 Min `energy_readings` + `room_temperature_samples`, schreibt nach `room_kpi_15min`
- pg_cron `*/15 * * * *`

**Memory-Updates:**
- `mem://index.md` Core-Regel: Gemini bleibt Default, Haiku-Ausnahme für Tagesplaner
- Neue Datei `mem://arch/daily-ai-planner.md` mit Provider, Cron, Fallback
- Neue Datei `mem://features/heating/ai-auto-mode-pilot.md` mit Kill-Switch + 3 Pilot-Parameter
- `mem://features/heating/ai-shadow-decisions.md` updaten (suggest+auto+rollback)

---

## Technische Details

**Tabellen-Layout `room_kpi_15min`:**
```sql
room_id uuid, bucket_start timestamptz, grid_import_wh numeric,
pv_used_wh numeric, heating_minutes int, temp_start numeric,
temp_end numeric, target_temp numeric, target_reached bool,
UNIQUE(room_id, bucket_start)
```

**Kill-Switch-Check in Advisor:**
```ts
const killSwitch = await sb.from('system_settings')
  .select('value').eq('key','ai_auto_mode_enabled').single();
if (killSwitch.data?.value?.enabled === false) {
  decision_mode = 'suggest'; // downgrade auto → suggest
}
```

**Rollback:** Button im Dashboard ruft Edge Function `rollback-ai-decision` mit decision_id → liest `current_value`, schreibt zurück, setzt `rollback_at`.

**Anthropic API Call (Tagesplaner):**
- Model: `claude-haiku-4-5` (aktuelles Haiku, Stand 2026)
- Tool-Use für strukturiertes JSON-Output (kein Prompt-Engineering für JSON)
- Timeout 30s, Retry 1× bei 5xx

## Reihenfolge der Genehmigungen

Du wirst pro Woche eine **Migration-Approval** sehen (Woche 1 große Migration, Woche 3+4 jeweils klein). Secrets-Dialog für `ANTHROPIC_API_KEY` kommt sofort zu Beginn von Woche 1.

## Out-of-Scope (bewusst nicht enthalten)

- Komplette Neuverdrahtung der Prioritätenreihenfolge 1–12 (Core-Regel)
- Ollama-Integration
- Lovable AI Gateway
- Ablösung von `ai-parameter-evaluator` (bleibt für Outcome-Scoring)
