# Vollautomatische KI-Parameter-Steuerung

## Ist-Zustand

Die Bausteine existieren bereits, laufen aber nur manuell:

- **`ai-parameter-advisor`** (Gemini Flash Lite) erzeugt Vorschläge. Wenn ein Parameter in `ai_parameter_whitelist` auf `autonomy_level = 'auto'` steht, wendet die Function ihn **schon heute** direkt an und schreibt `auto_applied = true` in `ai_parameter_decisions`.
- **`ai-parameter-evaluator`** misst nach X Minuten den Outcome-Score.
- **DB-Trigger `validate_ai_auto_apply`** auf `heating_settings` blockiert Auto-Writes hart, wenn der Master-Switch `system_settings.ai_auto_mode_enabled = false` ist, und prüft Min/Max/Allowed gegen die Whitelist.
- **Master-Switch**: `system_settings.ai_auto_mode_enabled` existiert (aktuell `true`), aber es gibt **keine UI** dafür und **keinen Cron**, der den Advisor regelmäßig anstößt.

Heißt: Die Sicherheits- und Apply-Logik ist fertig. Es fehlt nur **Automation (Cron)**, **UI-Schalter** und ein sauberes **Monitoring**.

## Zielbild

1. Advisor läuft **alle 15 min** automatisch (06:00–22:00 Vienna), schlägt Parameter vor und wendet alle `autonomy_level = 'auto'`-Parameter ohne Klick an.
2. Im Frontend gibt es einen prominenten **Master-Schalter** „KI-Autopilot aktiv". Aus = Trigger schreibt nicht mehr, neuer Cron-Lauf produziert nur noch Shadow-Decisions.
3. Pro Parameter bleibt der Drei-Stufen-Schalter `shadow / suggest / auto` (bestehende UI in KI-Parameter-Whitelist) bestehen — das ist die feine Steuerung.
4. Auto-Rollback bei schlechtem Outcome.

## Umsetzung

### 1. Master-Schalter im Frontend

Neue Komponente `AIAutopilotToggle` ganz oben in der KI-Tab-Seite (über `AIShadowDecisions`):

- Großer Switch + Status-Badge (`Aktiv` grün / `Pausiert` grau).
- Liest/schreibt `system_settings.ai_auto_mode_enabled` (`{ enabled: boolean }`).
- Zeigt eine kurze Klartext-Zusammenfassung:
  - Anzahl Parameter aktuell auf `auto` (aus `ai_parameter_whitelist`)
  - Letzter Advisor-Lauf (max `created_at` aus `ai_parameter_decisions`)
  - Auto-Applies heute + Ø Outcome-Score letzte 7 Tage
- Beim Ausschalten Bestätigungs-Dialog: „Laufende `auto`-Parameter bleiben unverändert, neue Vorschläge werden nicht mehr angewendet."

### 2. Cron für Advisor

Neuer pg_cron-Job `ai-parameter-advisor-15min`:
- Alle 15 min zwischen 06:00–22:00 Europe/Vienna
- `net.http_post` auf `ai-parameter-advisor` mit anon key
- Idempotent: Advisor entscheidet selbst, ob neue Decisions nötig sind (existiert dedupe? — siehe Schritt 4)

Wird per `supabase--insert` angelegt (User-spezifische URL/Key).

### 3. Evaluator + Auto-Rollback

Cron `ai-parameter-evaluator-hourly` (existiert evtl., sonst neu): stündlich. Erweiterung der Function:
- Wenn `outcome_score < -0.3` (konfigurierbar) **und** `auto_applied = true` **und** noch nicht zurückgerollt → automatischer Revert auf `current_value`, `rollback_at` setzen.
- Setzt den betroffenen Whitelist-Eintrag temporär auf `suggest` (Cool-Down 24 h), damit nicht sofort wieder dasselbe passiert.

### 4. Dedupe / Rate-Limit im Advisor

Damit der 15-min-Cron nicht spammt:
- Pro `parameter_key` max 1 Auto-Apply pro Stunde.
- Wenn `proposed_value` = `current_value` → kein Insert.

### 5. Sichtbarkeit & Audit

`AIShadowDecisions` ergänzen:
- Eigener Tab/Filter „Auto-Applied" (`auto_applied = true`).
- Pro Eintrag: Outcome-Score, Rollback-Button (manuell), Badge wenn Auto-Rollback erfolgte.

### 6. Memory & Doku

- Neuer Memory-Eintrag `mem://features/heating/ai-autopilot` mit Verhalten, Cron-Takt, Kill-Switch-Pfad.
- `CHANGELOG.md` Eintrag.

## Sicherheits-Garantien (bereits vorhanden, bleiben)

- Trigger `validate_ai_auto_apply` blockt jeden Auto-Write bei `ai_auto_mode_enabled = false` oder wenn Wert außerhalb Whitelist-Range.
- `pv-automation` bleibt alleinige Setpoint-Autorität — Autopilot ändert nur **Parameter** in `heating_settings`, keine Raum-Setpoints.
- Pro Parameter steuerbar via `autonomy_level` (`shadow` = nur loggen, `suggest` = Vorschlag in UI, `auto` = anwenden).

## Technische Details

| Komponente | Pfad |
|---|---|
| Master-Switch UI | `src/components/heating/AIAutopilotToggle.tsx` (neu) |
| Einbau | `src/components/heating/AIShadowDecisions.tsx` (oberhalb `AIDailyPlanCard`) |
| Cron Advisor | `pg_cron` job `ai-parameter-advisor-15min` (via `supabase--insert`) |
| Cron Evaluator | `pg_cron` job `ai-parameter-evaluator-hourly` |
| Advisor-Erweiterung | `supabase/functions/ai-parameter-advisor/index.ts` (Dedupe + 1/h-Limit) |
| Evaluator-Erweiterung | `supabase/functions/ai-parameter-evaluator/index.ts` (Auto-Rollback bei Score < −0.3) |
| Settings-Key | `system_settings.ai_auto_mode_enabled` (bereits vorhanden) |

## Offene Fragen

1. **Aktiv-Zeitfenster** des Cron: `06:00–22:00` ok, oder 24/7?
2. **Rollback-Schwelle**: Outcome-Score `< −0.3` als Default ok, oder strenger/lockerer?
3. **Cool-Down nach Rollback**: 24 h auf `suggest` herabstufen — ok, oder soll der Parameter komplett auf `shadow` zurückfallen?
