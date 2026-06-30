# Fix-Dokumentation: anon_key-Cron-Fix & analyze-patterns MAX_TOKENS

**Datum:** 30. Juni 2026 (Abend-Session)
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** pg_cron-Jobs (alle), Edge Function `analyze-patterns`

**Zusammenfassung:** In dieser Session wurden zwei Probleme bearbeitet.
(1) **Gelöst & bestätigt:** Alle Cron-getriggerten Edge-Function-Aufrufe scheiterten
mit HTTP 401, weil das DB-Setting `app.anon_key` `null` war. Fix: festen anon_key
direkt in alle Cron-Commands geschrieben.
(2) **Code-Fix deployt, Test offen:** Die KI-Analyse (`analyze-patterns`) brach mit
`422 MAX_TOKENS` ab. Ursache: zu kleines Token-Budget für das Gemini-Thinking-Modell.
Fix: Token-Budget erhöht + Thinking gedrosselt. Ein möglicher Folge-Fix
(`tool_calls: false`) ist identifiziert, aber noch nicht verifiziert.

---

## Problem 1 — Alle Cron-Jobs scheitern mit 401 (app.anon_key = null)  ✅ GELÖST

### Symptom
- Dashboard-Features tot: „Tagesmuster: zuletzt vor 5 Tagen", KI-Autopilot ohne Vorschläge.
- In `net._http_response` bei Cron-getriggerten Aufrufen: `401 UNAUTHORIZED_INVALID_JWT_FORMAT`, `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}`.

### Ursache
19 von 20 Cron-Jobs bauten ihre Header so:
```sql
headers := jsonb_build_object(
  'Content-Type','application/json',
  'apikey', current_setting('app.anon_key'),
  'Authorization','Bearer '||current_setting('app.anon_key'))
```
Das DB-Setting `app.anon_key` war jedoch **nicht gesetzt** (`null`). Damit ging ein
leerer/ungültiger JWT raus → 401. (Job 12 `compute-daily-score-daily` hatte den Key
bereits hartkodiert und funktionierte deshalb als Einziger.)

### Warum nicht einfach das Setting setzen?
`ALTER DATABASE postgres SET app.anon_key = '...'` schlägt im Supabase-SQL-Editor fehl:
```
ERROR: 42501: permission denied to set parameter "app.anon_key"
```
Der SQL-Editor läuft nicht als Superuser. Der saubere Weg ist daher, den Key **direkt
in die Cron-Commands** zu schreiben (der anon_key ist nicht geheim — er steckt ohnehin
im Frontend-Bundle und in `create-config.bat`).

### Fix (ausgeführt)
Ein DO-Block ersetzt in allen betroffenen Jobs `current_setting('app.anon_key')`
durch den echten Key:
```sql
DO $$
DECLARE
  real_key text := '<ANON_KEY_DES_PROJEKTS_pflnniklvqbwjwrjswaz>';
  j record;
BEGIN
  FOR j IN
    SELECT jobid, command FROM cron.job
    WHERE command LIKE '%current_setting(''app.anon_key'')%'
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := replace(
        j.command,
        'current_setting(''app.anon_key'')',
        '''' || real_key || ''''
      )
    );
  END LOOP;
END $$;
```
> Hinweis: Der echte anon_key steht in `create-config.bat` (Feld `anon_key`,
> Rolle `anon`, Projekt `pflnniklvqbwjwrjswaz`, gültig bis 2097). Nicht zusätzlich
> an anderer Stelle im Klartext ablegen als ohnehin schon.

### Verifikation (bestätigt)
Kontrolle, dass kein Job mehr `current_setting` nutzt:
```sql
select jobid, jobname
from cron.job
where command like '%current_setting(''app.anon_key'')%'
order by jobid;
-- Ergebnis: 0 Zeilen  ✓
```
Live-Test der pv-automation (über net.http_post mit festem Key):
- Ergebnis `200 {"success":true, ... "surplus":4618.6, "batterySoc":98.7, ...}`  ✓
- Vorher in derselben Antwortliste noch `401` sichtbar — danach nur noch `200`.

### Betroffene Jobs (Stand dieser Session)
| Job | Name | Vorher | Nachher |
|-----|------|--------|---------|
| 5–22 (außer 12) | diverse | `current_setting('app.anon_key')` | fester anon_key |
| 12 | compute-daily-score-daily | bereits fester Key | unverändert |

### WICHTIGE LEHRE für die Zukunft
- `app.anon_key` lässt sich im Supabase-SQL-Editor **nicht** per `ALTER DATABASE` setzen
  (permission denied). Cron-Jobs daher immer mit **festem** anon_key bauen.
- Wenn künftig Edge Functions neu deployt oder Cron-Jobs neu angelegt werden:
  **nicht** wieder `current_setting('app.anon_key')` verwenden — sonst kehrt der 401 zurück.

---

## Problem 2 — analyze-patterns: 422 MAX_TOKENS  ⚙️ FIX DEPLOYT, TEST OFFEN

### Symptom
- Dashboard „Tagesmuster neu auswerten" / Wochenvergleich: „Fehler bei der Analyse".
- Edge-Function-Logs (`analyze-patterns`):
  ```
  ERROR  AI error: 422 Gemini response truncated (MAX_TOKENS)
  INFO   Calling Google Gemini API (gemini-2.5-flash, type=weekly_comparison, temp=0.45, maxTokens=1024)
  ```

### Ursache
`gemini-2.5-flash` (und `-flash-lite`) sind **Thinking-Modelle**: Sie verbrauchen interne
Reasoning-Tokens, bevor Output entsteht. Mit nur `maxTokens=1024` war das Budget oft schon
durch das interne „Nachdenken" aufgebraucht → Antwort abgeschnitten
(`finishReason: MAX_TOKENS`) → die Funktion warf `422`.

Die Token-Obergrenze stammt aus `TYPE_TOKEN_MAP` in
`supabase/functions/analyze-patterns/index.ts`. Die alten Werte (512–2048) waren für ein
Thinking-Modell zu klein.

### Fix (in der LOKALEN Datei, deployt)
**Änderung 1 — Token-Map angehoben** (ca. Zeile 53–61):
```js
const TYPE_TOKEN_MAP: Record<string, number> = {
  optimize_decision: 8192,
  heating_optimization: 4096,
  room_heating_optimization: 4096,
  weekly_comparison: 4096,
  weekly_insight: 2048,
  daily_pattern: 2048,
  default: 4096,
};
```
**Änderung 2 — Thinking gedrosselt** (in `callAI`, im `geminiBody.generationConfig`,
ca. Zeile 101):
```js
    const geminiBody: any = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens,
        thinkingConfig: { thinkingBudget: 512 },
      },
    };
```
> `thinkingBudget: 0` (komplett aus) führte im Test zu leeren Tool-Antworten
> (siehe „Offener Punkt" unten). Deshalb kleiner, aber positiver Wert (512).

### Deployment
```bash
cd "C:\Heizung\smartfox-insight-ai-selfhosted-main (1)\smartfox-insight-ai-selfhosted-main"
supabase functions deploy analyze-patterns
# -> "Deployed Functions on project pflnniklvqbwjwrjswaz: analyze-patterns"  ✓
```

### Verifikation der DATEI (bestätigt)
```powershell
Select-String -Path "supabase\functions\analyze-patterns\index.ts" `
  -Pattern "thinkingBudget", "weekly_comparison: \d+"
# Zeile 57:  weekly_comparison: 4096        ✓
# Zeile 101: thinkingConfig: { thinkingBudget: 512 },  ✓
```

### OFFEN: Wirkungs-Test (morgen früh)
Der Funktions-Test ließ sich am Abend nicht sauber abschließen (SQL-Editor-Macke, s. u.).
Morgen früh prüfen:
1. Dashboard → „Tagesmuster neu auswerten" / Wochenvergleich klicken.
2. Supabase → Edge Functions → `analyze-patterns` → Logs.
3. Erwartung in der „Calling Google Gemini API"-Zeile: **maxTokens=4096** (nicht mehr 1024).
4. Erwartung: **has tool_calls: true** (nicht mehr false).

### MÖGLICHER FOLGE-FIX (nur falls Test weiter `tool_calls: false` zeigt)
Mit gedrosseltem Thinking **und** erzwungenem Function-Calling
(`functionCallingConfig: { mode: 'ANY' }`) liefern Gemini-2.5-Modelle teils eine leere
Antwort. Beobachtet im Log:
```
WARNING  Expected tool call for weekly_insight but got text response: no content
INFO     Tool calling mode: true, toolName: weekly_insight, has tool_calls: false
```
Falls das nach dem 4096-Deploy bestehen bleibt, in `analyze-patterns/index.ts`
(in `callAI`, beim Tool-Setup) testweise umstellen:
```js
geminiBody.toolConfig = {
  functionCallingConfig: { mode: 'AUTO' }   // statt 'ANY'
};
```
Danach erneut deployen und testen. (Nicht im Voraus ändern — erst Test des 4096-Stands.)

---

## Werkzeug-Fallen dieser Session (wichtig für die Zukunft)

### 1) GitHub-Web-Editor ≠ Deploy
Lange Zeit wurde im **GitHub-Web-Editor** geändert, während `supabase functions deploy`
die **lokale Datei** auf der Platte deployt. Beide Orte liefen auseinander → der Deploy
schob immer den alten Code (1024). **GitHub-Commit löst KEIN Supabase-Deploy aus.**
- Konsequenz: Code-Änderungen, die live wirken sollen, **lokal** machen, dann deployen.
- Danach (optional) dieselbe Änderung nach GitHub committen, damit Repo = Deploy.

### 2) SQL-Editor hängt `limit 100` an
Lange `SELECT net.http_post(...)`-Aufrufe scheitern im Supabase-SQL-Editor mit
`unterminated quoted string` bzw. `syntax error at or near "limit"`, weil der Editor
automatisch `limit 100` an das Statement hängt — mitten in den langen JWT/Body.
- Abhilfe 1: im Editor von „LIMIT 100" auf **„No limit"** umstellen.
- Abhilfe 2: Edge Functions **nicht** per SQL testen, sondern über den
  **Dashboard-Button** auslösen und in den **Edge-Function-Logs** prüfen (zuverlässig).
- `DO $$ ... $$`-Blöcke umgehen das Limit teils, scheitern aber selbst gelegentlich
  am `$$`-Quoting im Editor.

### 3) Warme Edge-Function-Instanzen
Direkt nach einem Deploy bedienen teils noch „warme" alte Instanzen die Aufrufe
(alter Code). Nach Deploy ~1 Min warten, bevor man das Log als Beweis nimmt.

### 4) net._http_response ist unübersichtlich
Bei vielen parallelen Cron-Aufrufen gehen einzelne Antworten im Strom unter; Filter auf
`quota`/`rate` liefern Fehltreffer (z. B. enthält die normale pv-automation-Antwort
`"quotaExhausted":false`). **Edge-Function-Logs** sind die verlässliche Quelle.

---

## Status am Ende der Session

**Gesund / läuft:**
- Heizungssteuerung 12/12 Räume, pv-automation im 2-Min-Takt (200).
- Nachtmodus korrekt geschaltet (22:00, frost_only, 5 °C).
- Alle Cron-Jobs mit festem anon_key → keine 401 mehr.

**Erledigt:**
- ✅ anon_key-Fix in allen Cron-Jobs (verifiziert, 0 Jobs mit `current_setting`).
- ✅ analyze-patterns: Token-Map 4096 + thinkingBudget 512 in lokaler Datei, deployt.

**Offen (morgen früh):**
1. analyze-patterns testen (Dashboard-Button + Logs): maxTokens=4096? tool_calls=true?
   - Falls tool_calls weiter false → `mode: 'ANY'` → `'AUTO'` (siehe oben), neu deployen.
2. Verifikations-Checkliste (nach ~9–10 Uhr Wien, frische Gemini-Quota):
   ```sql
   select plan_date, source, created_at from ai_daily_plans order by created_at desc limit 1;
   select date, expected_kwh, created_at from pv_forecasts order by date desc limit 3;
   select created_at, parameter_key, decision_mode, proposed_value from ai_parameter_decisions order by created_at desc limit 10;
   ```
3. `ANTHROPIC_API_KEY` rotieren (war im Klartext exponiert):
   `console.anthropic.com` → revoke → neu → am PC `supabase secrets set ANTHROPIC_API_KEY=...`
   (Wert nicht in Chats kopieren).
4. analyze-patterns-Änderung auch nach GitHub committen (Repo = Deploy synchron halten).

**Kosmetische Befunde (nicht dringend, in analyze-patterns):**
- `Europe/Berlin` statt `Europe/Vienna` als Default in `isNightTimeFromSettings`/`getLocalHour`
  — funktional harmlos (gleiche Zeitzone).
- Prompt-Nummerierung im `optimize_decision`-Block springt von „3." auf „5." (rein kosmetisch).
- Finaler `else`-Zweig liest `readings?.energy_in/out` (Felder werden nicht mehr befüllt) —
  nur relevant, falls dieser Default-Pfad je genutzt wird.
