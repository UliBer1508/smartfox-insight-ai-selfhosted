# Lösungskonzept: KI-Vorschlagssystem `heating_min_battery_soc` + Automations-Status-UI

## Leitprinzip
KI **schlägt vor**, Nutzer **bestätigt**. Kein Edge-Function außer `battery-soc-decision` darf `heating_min_battery_soc` (und andere `LOCKED_PARAMS`) schreiben. UI macht den Automationszustand permanent sichtbar.

---

## Teil 1 — Datenbank (Migration)

Neue Tabelle `battery_soc_suggestions`:
- `id uuid pk`, `created_at timestamptz default now()`
- `old_value int not null`, `new_value int not null`
- `pv_forecast_kwh numeric(6,2)`, `avg_pv_7d_kwh numeric(6,2)`, `soc_end_of_day int`
- `reason_text text`
- `status text default 'pending' check (status in ('pending','accepted','dismissed'))`
- `decided_at timestamptz`, `decided_by text default 'user'`
- Index auf `(status, created_at desc)`; Partial-Unique-Index für max. 1 `pending`
- RLS: authenticated full access; anon read (Dashboard polling) optional, ansonsten authenticated-only

`heating_settings` erweitern:
- `battery_soc_suggestion_enabled boolean default true`

Trigger `validate_ai_auto_apply` (existierend) muss `heating_min_battery_soc` weiterhin als locked behandeln — Update über `battery-soc-decision` läuft mit `service_role`, daher unkritisch.

---

## Teil 2 — Edge-Function `ai-parameter-advisor` (neue Route)

Neuer Pfad: `POST /suggest-battery-soc` im bestehenden Router.

Ablauf exakt nach Spec:
1. Lade `heating_settings` (`heating_min_battery_soc`, `battery_soc_suggestion_enabled`)
2. Skip wenn `battery_soc_suggestion_enabled !== true`
3. Skip wenn bereits `pending`-Eintrag existiert (Single-Open-Suggestion)
4. PV morgen aus `pv_forecasts.expected_kwh` (date = tomorrow Europe/Vienna)
5. Ø 7 Tage `expected_kwh` aus `pv_forecasts`
6. `soc_at_heating_end` letzter Eintrag aus `battery_daily_tracking`
7. Decision-Table (PV morgen × SOC gestern):
   - `>20 kWh` & SOC `>80%` → `max(old−10, 50)`
   - `>20 kWh` & SOC `70–80%` → `max(old−5, 50)`
   - `10–20 kWh` → kein Vorschlag
   - `<10 kWh` & SOC `<70%` → `min(old+5, 90)`
   - `<10 kWh` & SOC `<60%` → `min(old+10, 90)` (Vorrang vor +5)
8. Skip wenn `new == old`
9. Klartextbegründung (DE, ≤3 Sätze) — Template-basiert mit PV/SOC-Werten (kein LLM nötig, deterministisch & quotaschonend)
10. Insert mit `status='pending'`

Aufruf: ausschließlich von `analysis-scheduler` (siehe unten). KEIN Trigger aus `pv-automation`.

---

## Teil 3 — Edge-Function `battery-soc-decision` (neu)

`POST /battery-soc-decision`, Body: `{ suggestion_id, action: 'accept'|'dismiss' }`
- JWT-validiert (authenticated user)
- Lade Suggestion → 400 wenn nicht `pending`
- `accept`: UPDATE `heating_settings.heating_min_battery_soc = new_value`; suggestion → `accepted`, `decided_at = now()`
- `dismiss`: suggestion → `dismissed`, `decided_at = now()`
- Return `{ success, new_value? }`

Dies ist der **einzige** Pfad, der `heating_min_battery_soc` ändern darf (neben manuellem UI-Save in den Heating-Settings).

---

## Teil 4 — Analyse-Scheduler erweitern

`analysis-scheduler` bekommt Trigger `suggest_battery_soc` täglich **21:00 Europe/Vienna**.
Settings-UI (Inline) bekommt analog zu bestehenden Schedulern Toggle + Zeitfeld (optional, Default 21:00).

Memory-Update: `mem://features/heating/analysis-scheduler` ergänzen.

---

## Teil 5 — Frontend

### 5.1 Automations-Status-Karte (`src/components/dashboard/AutomationStatusCard.tsx`)
Permanent oberhalb Raum-Übersicht.
- **Zeile 1**: Status-Badge (grün/gelb/grau) abgeleitet aus: `pv_automation` Heartbeat (`service_health.last_sync`), `api_errors` (offen?), `system_settings.ai_auto_mode_enabled`.
- **Zeile 2 — 4 Metric-Cards**:
  - Batterie-Gate: `heating_min_battery_soc` % + Subtext „manuell" oder „KI-Vorschlag übernommen am [Datum]" (letzter `accepted` aus `battery_soc_suggestions`)
  - Budget-Modus: `system_settings.parallel_heating_capacity.budget_mode`
  - Mikro-Budget: `micro_budget_enabled` + Live-Check ob SOC ≥ (`heating_min_battery_soc + 5`)
  - SOC-Gate-Modus: `heating_soc_gate_mode`
- **Zeile 3 — Chips**: Nacht-Modus, PV-Hysterese `on/off W`, „WW: Smartfox-autonom" (grau, statisch), nächster Scheduler-Run.
- Polling: React Query `refetchInterval: 30000`.

### 5.2 KI-Vorschlags-Karte (`src/components/dashboard/BatterySocSuggestionCard.tsx`)
Nur bei `pending`-Eintrag.
- Oranger Rand (`border-warning` Token, nicht hex), Roboter-Icon (`Bot` aus lucide), Timestamp + Quelle
- Großer Vergleich `old → new` mit `ArrowRight`
- Reason-Text in `bg-muted` Block
- 3 Metric-Cards (PV morgen, Ø 7d, SOC gestern)
- Aktionen: „Übernehmen — Gate auf XX%" / „Ablehnen" → `supabase.functions.invoke('battery-soc-decision', ...)`
- Optimistic Update + invalidate `automation-status` und `battery-soc-history` Queries.

### 5.3 Verlaufs-Karte (`src/components/dashboard/BatterySocHistoryCard.tsx`)
Tabelle, max. 10 Einträge:
- Quellen mergen: `battery_soc_suggestions` + synthetische „Manuell"-Zeilen aus `heating_settings.updated_at`-Audit (für saubere History: optional kleine `heating_settings_audit`-Tabelle via Trigger, oder einfach nur die Suggestions historisieren und Manuelle ausblenden — **Entscheidung**: ohne neue Audit-Tabelle, nur Suggestions; manuelle Änderungen erscheinen ab jetzt nur über Suggestions/Direkt-Save als „Manuell"-Marker via separatem Insert beim Save). Einfachste Variante: nur `battery_soc_suggestions` anzeigen, „Manuell" ergänzen wenn beim UI-Save direkt eine Suggestion mit `status='accepted'`, `decided_by='manual'` erzeugt wird.
- Status-Badges via semantischer Tokens.

### 5.4 Einstellungsseite (`HeatingSettingsForm.tsx`)
- Infoblock unter `heating_min_battery_soc` (Text gem. Spec)
- Toggle `battery_soc_suggestion_enabled`
- Migrations-Banner (bereits existent gem. Memory) bleibt unverändert

---

## Teil 6 — Locked Params Guard Review

Audit aller Edge-Functions die `heating_settings` updaten:
- `pv-automation`, `monitor-solar-heating`, `ai-parameter-evaluator`, `ai-parameter-advisor`, `apply-recommendations`, `ai-daily-planner`

Maßnahmen:
- Zentrale Helper-Konstante `LOCKED_PARAMS` (bereits in advisor/evaluator vorhanden) als Kommentar-Hinweis + Filter in jedem UPDATE-Statement (explizite Whitelist statt `update(settingsObject)`).
- Code-Kommentar `// LOCKED_PARAMS guard — see mem://security/ki-locked-core-params` an jedem Touchpoint.
- `battery-soc-decision` ist explizit ausgenommen.

---

## Technische Details

**Dateien neu:**
- `supabase/migrations/<ts>_battery_soc_suggestions.sql`
- `supabase/functions/battery-soc-decision/index.ts`
- `src/components/dashboard/AutomationStatusCard.tsx`
- `src/components/dashboard/BatterySocSuggestionCard.tsx`
- `src/components/dashboard/BatterySocHistoryCard.tsx`
- `src/hooks/useAutomationStatus.ts`, `useBatterySocSuggestion.ts`

**Dateien geändert:**
- `supabase/functions/ai-parameter-advisor/index.ts` (neue Route + Decision-Logic)
- `supabase/functions/analysis-scheduler/index.ts` (Trigger 21:00)
- `src/components/heating/HeatingSettingsForm.tsx` (Toggle + Infoblock)
- Dashboard-Seite (Karten einbinden)
- Edge-Functions Audit (Locked-Params-Kommentare)
- `supabase/config.toml` (function entries für neue function, falls non-default nötig — voraussichtlich nicht)
- `.lovable/CHANGELOG.md`, `.lovable/TODO.md`
- Memory: `mem://features/heating/analysis-scheduler`, `mem://security/ki-locked-core-params`, neuer Leaf `mem://features/heating/battery-soc-suggestion-system`

**Cron**: `pg_cron` Job für `analysis-scheduler` existiert bereits; nur interner Dispatcher um `suggest_battery_soc` erweitern.

**Design-Tokens**: alle Farben via semantische Tokens (`warning`, `success`, `muted`) — kein Inline-Hex.

---

## Offene Punkte zur Bestätigung
1. **History „Manuell"-Zeilen**: ohne neue Audit-Tabelle (nur via Suggestion-Insert beim manuellen Save mit `decided_by='manual'`) — OK?
2. **Banner-Persistenz**: localStorage (einfach) statt `system_settings` — OK?
3. **Reason-Text**: deterministisches Template (kein LLM-Call, spart Quota) — OK?

Bei „ja" zu allen drei: direkte Umsetzung in dieser Reihenfolge: Migration → Edge-Functions → Scheduler → UI → Guard-Audit.
