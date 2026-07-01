# Fix-Dokumentation: analyze-patterns final & Gemini-Billing

**Datum:** 1. Juli 2026 (Vormittag-Session)
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** Edge Function `analyze-patterns`, Google-AI-Billing, GitHub-Repo, pg_cron `fetch-pv-forecast`

**Zusammenfassung:** In dieser Session wurde die von gestern Abend offene `analyze-patterns`-Baustelle
vollständig geschlossen. Dabei kam eine **dreischichtige** Fehlerkette zum Vorschein: (1) zu kleines
Token-Budget beim Analyse-Typ `daily_pattern`, (2) Tool-Calling-Verhalten (`tool_calls: false`),
(3) darunter das echte Gemini-Free-Tier-Limit (429). Alle drei behoben. Zusätzlich: Repo mit
Live-Stand synchronisiert und die PV-Prognose-Baustelle von gestern als gelöst verifiziert.
Zwei Punkte bewusst vertagt (ANTHROPIC-Key-Rotation, Haiku-Migration).

---

## Ausgangslage (offen aus der Abend-Session vom 30.06.)

Laut `FIX-ANON-KEY-UND-ANALYZE-PATTERNS-2026-06-30.md` war der Token-Fix für `analyze-patterns`
(Token-Map `weekly_comparison: 4096`, `thinkingBudget: 512`) zwar deployt, aber die **Wirkung
noch nicht verifiziert**. Der Dashboard-Button „Tagesmuster neu auswerten" warf weiterhin
„Fehler bei der Analyse".

---

## Problem 1 — analyze-patterns: `daily_pattern` weiterhin MAX_TOKENS  ✅ GELÖST

### Symptom
Dashboard „Tagesmuster neu auswerten" → „Fehler bei der Analyse".
Edge-Function-Log:
```
INFO   Calling Google Gemini API (gemini-2.5-flash, type=daily_pattern, temp=0.65, maxTokens=2048)...
INFO   Gemini API response received
ERROR  AI error: 422 Gemini response truncated (MAX_TOKENS)
```

### Ursache — die eigentliche Erkenntnis
Gestern wurde **nur** `weekly_comparison` auf 4096 gehoben. Der Button „Tagesmuster" ruft aber
`type=daily_pattern` auf — und **dieser** Wert stand in `TYPE_TOKEN_MAP` weiterhin auf `2048`
(nie angefasst). Es war **kein** nächtlicher Rücksetzer, sondern schlicht eine übersehene Zeile.
Für das Gemini-Thinking-Modell reichen 2048 nicht — das interne „Nachdenken" verbraucht das
Budget, bevor Output entsteht → Antwort abgeschnitten → `422 MAX_TOKENS`.

Beweis im Log durch direkten Vergleich:
- alter Lauf `maxTokens=2048` → 11 s später `422 MAX_TOKENS`
- neuer Lauf `maxTokens=4096` → `Gemini API response received`, kein MAX_TOKENS

### Fix
`supabase/functions/analyze-patterns/index.ts`, Zeile 59:
```js
// vorher
daily_pattern: 2048,
// nachher
daily_pattern: 4096,
```
Ausgeführt per PowerShell:
```powershell
(Get-Content "supabase\functions\analyze-patterns\index.ts") `
  -replace 'daily_pattern: 2048,', 'daily_pattern: 4096,' `
  | Set-Content "supabase\functions\analyze-patterns\index.ts"
supabase functions deploy analyze-patterns
```

---

## Problem 2 — analyze-patterns: Tool-Calling `tool_calls: false`  ✅ GELÖST

### Symptom (nach dem 4096-Deploy sichtbar)
Nachdem MAX_TOKENS weg war, kam die nächste Schicht zum Vorschein:
```
INFO  Tool calling mode: false, toolName: , has tool_calls: false
```
Dashboard weiterhin „Fehler bei der Analyse".

### Ursache
Die Funktion zwang Gemini per `functionCallingConfig: { mode: 'ANY' }` einen Tool-Call auf.
Gemini-2.5-Modelle mit gedrosseltem Thinking liefern dann teils **Text statt Tool-Call**
(leere `tool_calls`). Genau der in der Abend-Doku vorbereitete „mögliche Folge-Fix".

### Fix
`analyze-patterns/index.ts`, Zeile 112:
```js
// vorher
functionCallingConfig: { mode: 'ANY' }
// nachher
functionCallingConfig: { mode: 'AUTO' }
```
```powershell
(Get-Content "...\index.ts") `
  -replace "functionCallingConfig: \{ mode: 'ANY' \}", "functionCallingConfig: { mode: 'AUTO' }" `
  | Set-Content "...\index.ts"
supabase functions deploy analyze-patterns
```

### WICHTIGE Erkenntnis zu `tool_calls: false` bei `daily_pattern`
Nach dem `AUTO`-Deploy zeigt das Log für `daily_pattern` **weiterhin** `tool_calls: false` —
**aber ohne ERROR**, gefolgt von `AI response processed`. Das ist **kein Fehler**:
Der Analyse-Typ `daily_pattern` akzeptiert offenbar auch eine **Textantwort** ohne erzwungenen
Tool-Call. `tool_calls: false` ist hier normales Verhalten, solange kein ERROR folgt.
(Der zwingende Tool-Call war laut Abend-Doku eher bei `weekly_insight` das Thema.)

---

## Problem 3 — Gemini 429 Free-Tier-Limit  ✅ GELÖST (Billing aktiviert)

### Symptom
Nach den beiden Code-Fixes tauchte die **eigentliche** Ursache auf:
```
INFO     Calling Google Gemini API (... maxTokens=4096)...
WARNING  Gemini rate limit exceeded
ERROR    AI error: 429 Rate limit exceeded - verwende deterministischen Fallback
```
Zusätzlich sporadisch `503 "This model is currently experiencing high demand"`
(reines Google-Auslastungsproblem, unabhängig, vom Fallback abgefangen).

### Einordnung
**Kein Code-Bug.** Das Free-Tier-Tageslimit war erreicht. Dasselbe Limit bremst auch den
KI-Autopilot (`ai-parameter-advisor`). Der deterministische Fallback verhindert Abstürze,
liefert aber nur ein regelbasiertes Ersatz-Ergebnis statt frischer KI-Analyse.

### Fix — bezahltes Google-AI-Tier
In **Google AI Studio → API-Schlüssel** hat das Projekt `Default Gemini Project`
(`gen-lang-client-0894854093`) ein Rechnungskonto bekommen. **Billing gilt pro Projekt**,
nicht pro Key — alle drei Keys (u. a. „...MOrQ — Gemini API Key für Heizungssteuerung",
das ist der `GOOGLE_AI_API_KEY` des Systems) profitieren gleichzeitig.

- Vorher: Abrechnungsstufe = „Kostenlose Stufe"
- Nachher: „Mein Rechnungskonto · Preisstufe 1 · **Vorauszahlung**"
- **25 € Guthaben** vorausgezahlt → harter Deckel, Ausgaben können das Guthaben nicht überschreiten.

**Wichtig:** Der API-Key selbst ändert sich dabei **nicht**. In Supabase/Code musste **nichts**
angefasst werden — derselbe Key bekommt nur höhere Limits.

### Verifikation (bestätigt im Log)
- Lauf `08:02:41` (vor Billing): `429 ... deterministischen Fallback`
- Lauf `08:12:48` (nach Billing): `maxTokens=4096` → `Gemini API response received`
  → `AI response processed` — **kein 429 mehr**.

### Kosten-Hinweis
`gemini-2.5-flash`/`-flash-lite` sind sehr günstig (Cent pro Mio. Tokens). Bei dem geringen
Aufrufvolumen realistisch Cent bis wenige Euro/Monat. Empfehlung: in der Google-Cloud-Console
zusätzlich ein **Budget mit E-Mail-Alert** setzen (z. B. 5 €, Alert bei 80 %) als Schutz vor
theoretischen Ausreißern. (Die 25-€-Vorauszahlung deckelt ohnehin hart.)

---

## GitHub-Repo synchronisiert  ✅

### Problem
Der Deploy-Ordner (lokal gepatcht) und die **Live-Function** waren dem **GitHub-Repo voraus**.
Risiko: Ein späterer Repo-Pull überschreibt die Fixes wieder mit dem alten kaputten Stand
(genau die „GitHub-Commit ≠ Deploy"-Falle).

### Zusätzliche Stolperfalle dieser Session — DREI Kopien der Datei
Beim Versuch zu committen zeigte sich: Es existierten **drei** Stände von `index.ts`:
1. **Deploy-Ordner** (`C:\Heizung\...\analyze-patterns\index.ts`) — heute gepatcht (4096/AUTO)
2. **GitHub-Repo** — alter Stand (2048/ANY)
3. **hochgeladene Datei** (aus dem Repo geladen) — ebenfalls alter Stand (2048/ANY)

→ Verwechslungsgefahr. Sauber gelöst, indem die Datei zentral gepatcht, in den Deploy-Ordner
kopiert, neu deployt **und** ins Repo committet wurde. Jetzt tragen **alle drei** denselben Stand.

### Endstand aller vier Token-/Config-Werte (verifiziert)
```
Zeile 57:  weekly_comparison: 4096      (gestern)
Zeile 59:  daily_pattern: 4096          (heute)
Zeile 101: thinkingConfig: { thinkingBudget: 512 }   (gestern)
Zeile 112: functionCallingConfig: { mode: 'AUTO' }   (heute)
```
(Zeile 50 `daily_pattern: 0.65` = Temperatur, unverändert.)

### GRUNDSATZ-BEFUND für später (Setup-Schwachpunkt)
Der lokale Ordner ist ein **ZIP-Download von GitHub** (`...-main`), **kein `git clone`**
(`git status` → „not a git repository"). Deshalb kennen lokaler Ordner und Repo einander nicht,
jede Änderung muss doppelt gepflegt werden → Quelle des „welche Kopie gilt?"-Chaos.
**Git ist installiert** (`C:\Program Files\Git\cmd\git.exe`), aber **nicht im PATH**.
**Empfehlung (eigenes kleines Projekt):** Repo per `git clone` neu aufsetzen → eine Quelle der
Wahrheit, Ablauf künftig: lokal ändern → `git commit` → `git push` → `supabase functions deploy`.

---

## PV-Prognose-Baustelle von gestern — verifiziert GELÖST  ✅

Gestern war `forecast_heute = 0` (kein Eintrag für heute) die zentrale Blockade für **beide**
KI-Funktionen (Planner + Advisor). Nach der gestrigen Cron-Umstellung (`fetch-pv-forecast`
jetzt 6:00 Wien / 04:00 UTC) heute geprüft:

```sql
select date, expected_kwh, created_at from pv_forecasts where date >= current_date order by date;
```
Ergebnis:
| date       | expected_kwh | created_at (UTC)              |
|------------|--------------|-------------------------------|
| 2026-07-01 | 33.9         | 2026-06-30 06:00:45+00        |  ← heute, gestern früh erzeugt
| 2026-07-02 | 74           | 2026-07-01 04:00:07+00        |  ← morgen, heute 6:00 Wien erzeugt

**Bewertung:**
- Der 6-Uhr-Cron **läuft** (Eintrag für morgen mit `created_at` heute 04:00 UTC = 6:00 Wien).
- Für **heute** existiert ein Eintrag → `forecast_heute` **nicht mehr 0** → Blockade gelöst.
- KI-Funktionen (Autopilot, Tagesplan) haben wieder ihre Datengrundlage.

### Feinschliff-Frage für später (kein akutes Problem)
Der Job schreibt morgens die Prognose für **morgen**. Für **heute** wird der gestrige Eintrag
genutzt. Konzeptionell sauberer wäre, wenn `fetch-pv-forecast` **beides** aktualisiert:
Vorschau auf morgen (für vorausschauende Akku-/Nachtlogik) **und** eine frische Prognose für
**heute** (die die Heizlogik jetzt für die PV-Budget-Entscheidung braucht). Prüfen, ob die
Funktion nur den Folgetag oder auch den aktuellen Tag schreibt.

---

## Werkzeug-Fallen dieser Session (Ergänzung zur Abend-Doku)

1. **Gestaffelte Fehler richtig lesen:** Ein Symptom („Fehler bei der Analyse") hatte drei
   unabhängige Ursachen übereinander. Erst als Schicht 1 (Tokens) weg war, wurde Schicht 2
   (Tool-Calling) sichtbar; erst danach Schicht 3 (429). Ohne saubere Log-Analyse dreht man
   leicht am Falschen. **Immer die konkrete Log-Zeile prüfen** (maxTokens-Wert, ERROR vs. INFO).
2. **`daily_pattern` ≠ `weekly_comparison`:** Verschiedene Analyse-Typen haben eigene
   Token-Werte in `TYPE_TOKEN_MAP`. Einen Typ zu fixen heilt die anderen nicht.
3. **`tool_calls: false` ist nicht automatisch ein Fehler** — nur in Kombination mit einem
   folgenden ERROR. Bei `daily_pattern` ist Textantwort ok.
4. **Drei Datei-Kopien beim ZIP-Download-Setup** (siehe GitHub-Abschnitt) — Hauptquelle von
   Verwechslung. Beim Committen immer den **tatsächlich deployten** Stand als Wahrheit nehmen.
5. **Warme Instanzen:** Nach jedem Deploy ~1 Min warten, sonst bedient alter Code den Test.

---

## Status am Ende der Session (1. Juli 2026)

**Erledigt / verifiziert:**
- ✅ `analyze-patterns` `daily_pattern` auf 4096 → kein MAX_TOKENS mehr.
- ✅ `analyze-patterns` `functionCallingConfig` auf `AUTO` → Tool-Calling-Verhalten geklärt.
- ✅ Gemini-Billing aktiv (Preisstufe 1, 25 € Vorauszahlung) → **kein 429 mehr**;
      Autopilot profitiert automatisch mit.
- ✅ analyze-patterns nach GitHub committet → Deploy-Ordner = Live = Repo (alle vier Werte).
- ✅ PV-Prognose für heute vorhanden → gestrige `forecast_heute=0`-Blockade gelöst.

**Bewusst vertagt:**
- ⏳ `ANTHROPIC_API_KEY` rotieren (war im Klartext exponiert). Heute NICHT gemacht — bewusste
  Entscheidung. Solange offen: gelegentlich die Nutzungsübersicht auf console.anthropic.com
  prüfen (unerwartete Aufrufe = Signal für Missbrauch). Ablauf zur Rotation:
  `console.anthropic.com` → revoke → neu → am PC `supabase secrets set ANTHROPIC_API_KEY=...`
  (Wert NICHT in Chats kopieren) → `supabase secrets list` (zeigt nur Hash).
- ⏳ **Haiku-Migration der Gemini-Funktionen** als Lernprojekt vorgemerkt (nicht nötig, da
  Billing das 429 löst). Aufwand-Einschätzung: `analyze-patterns` allein ~2–4 h (Tool-Calling-
  Formate + Response-Parsing umschreiben, mehrere Deploy-Test-Runden), danach
  `ai-parameter-advisor` ~1–2 h. Vorlage vorhanden: `ai-daily-planner` läuft bereits auf
  Claude-Haiku. Umbaustellen: (1) API-Call-Struktur, (2) Tool-Definition Gemini→Anthropic,
  (3) Response-Parsing (`data.content[]`-Blöcke statt `choices[].message`).

**Kontrollblick morgen früh (nach ~9–10 Uhr Wien):**
```sql
-- Autopilot schreibt jetzt Decisions? (Billing + PV-Prognose beide vorhanden)
select created_at, parameter_key, decision_mode, proposed_value
from ai_parameter_decisions order by created_at desc limit 10;
-- Tagesplan automatisch + korrektes Datum?
select plan_date, source, created_at from ai_daily_plans order by created_at desc limit 1;
-- PV-Prognose (auch für heute frisch?)
select date, expected_kwh, created_at from pv_forecasts order by date desc limit 3;
```

**Weiterhin offen (unverändert, für Österreich / später):**
- Collector auf neues Supabase-Projekt umbiegen (config.json: URL + anon_key) — Go-live-kritisch.
- NSSM-Dienste finalisieren (Startbefehle/Pfade der 3 Prozesse; Wallbox-Typ unklar).
- Optional: Historien-Import, DHCP-Reservierungen Thermostat-IPs, ApiErrorBanner-Glättung,
  Repo-Sichtbarkeit final auf privat verifizieren, Setup auf `git clone` umstellen.
- Ganz zum Schluss (nach stabilen Tagen): Lovable-Projekt löschen.
