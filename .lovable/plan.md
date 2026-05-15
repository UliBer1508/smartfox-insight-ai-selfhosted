## Ursache

Edge-Function-Logs zeigen den Grund für „Noch keine KI-Vorschläge":

```
2026-05-15T06:55:21Z ERROR Gemini error 429 …
  Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash
2026-05-15T07:00:05Z ERROR Gemini error 503 (UNAVAILABLE)
2026-05-15T07:02:59Z ERROR Gemini error 503 (UNAVAILABLE)
```

Drei zusammenhängende Probleme:

1. **Quota:** `gemini-2.5-flash` Free-Tier = **20 Requests/Tag**. Der Cron `ai-parameter-advisor-15min` feuert **96×/Tag** → täglich nach ~5h erschöpft.
2. **Service-Spitzen:** Selbst bei freiem Kontingent kommen aktuell `503 UNAVAILABLE` zurück (Modell-Last).
3. **UI verschluckt den Fehler:** `triggerRun()` zeigt `toast.success(`accepted: 0 …`)` auch wenn die Function `{ ok:false, error:"gemini_503" }` zurückgibt — der Empty-State bleibt mit dem generischen „Klick auf Jetzt analysieren" stehen.

## Plan

### 1. Quota-freundlicheres Modell für den Advisor
`supabase/functions/ai-parameter-advisor/index.ts`: Wechsel von `gemini-2.5-flash` auf **`gemini-2.5-flash-lite`** (Free-Tier 1000 RPD, 30 RPM, gleiche JSON-Tool-Fähigkeit, klassifikations-/extraktions-tauglich für Parameter-Vorschläge). Memory-Eintrag „AI Standardization" wird ergänzt: Advisor läuft auf `flash-lite`, Sonderfälle dürfen weiterhin `flash` nutzen.

### 2. Cron entlasten + Retry/Backoff
- Cron `ai-parameter-advisor-15min` umstellen auf **stündlich** (`0 * * * *`) → 24 Calls/Tag, weit unter Limit, deckt Tageszyklus weiterhin sauber ab.
- In der Function bei `429`/`503` einmaliger Retry mit 30 s Wartezeit (Gemini liefert `retryDelay`), bevor `ok:false` zurückkommt.
- Bei finalem 429/503: Antwort mit HTTP-Status `503` und Body `{ ok:false, error, retry_after }`, damit der Client einen echten Fehlerpfad bekommt.

### 3. UI: Fehler sichtbar machen
`src/components/heating/AIShadowDecisions.tsx`:
- `triggerRun()` prüft jetzt `data?.ok === false` und zeigt einen verständlichen Toast (z. B. „Gemini-Limit erreicht — neuer Versuch um HH:MM").
- Letzter Fehler wird in lokalem State gehalten und im Empty-State **statt** des Platzhaltertexts angezeigt: Datum + Grund + Hinweis „Cron läuft stündlich, nächster automatischer Versuch um …".
- Wenn die letzte Analyse erfolgreich war, aber 0 Vorschläge geliefert hat, klare Meldung „Keine Verbesserungen vorgeschlagen — System läuft im Sweet-Spot."

### 4. Memory-Update
- `mem://arch/ai-provider-standardization` ergänzen: Modell-Tabelle Advisor=`flash-lite`, Default-Quoten-Strategie.
- `mem://features/heating/ai-shadow-decisions` ergänzen: Cron-Frequenz stündlich, UI-Fehler-Surface.

## Out of Scope
- Wechsel auf Lovable AI Gateway (laut Memory ausgeschlossen).
- Auto-Apply-Logik (`autonomy_level: auto`) bleibt UI-only ohne Ausführung.
- Änderungen an `ai-parameter-evaluator` oder Whitelist-Schema.
