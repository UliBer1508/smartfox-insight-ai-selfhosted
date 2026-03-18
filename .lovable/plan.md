

# Plan: AI-Aufrufe auf Lovable AI Gateway umstellen + Cache-TTL erhöhen

## Änderungen

### 1. `supabase/functions/analyze-patterns/index.ts`
Die `callGoogleAI`-Funktion (Zeilen 27-145) und `callAI`-Wrapper (Zeilen 148-158) ersetzen durch eine neue `callAI`-Funktion, die den Lovable AI Gateway nutzt:
- Endpoint: `https://ai.gateway.lovable.dev/v1/chat/completions`
- Auth: `Bearer ${LOVABLE_API_KEY}`
- Model: `google/gemini-2.5-flash`
- Body direkt im OpenAI-Format senden (messages, tools, tool_choice) -- keine Google-Format-Konvertierung mehr nötig
- Response ist bereits OpenAI-kompatibel -- keine Rück-Konvertierung nötig
- Fehlerbehandlung für 429 (Rate Limit) und 402 (Credits erschöpft)
- **~120 Zeilen weniger Code**

### 2. `supabase/functions/generate-settings-suggestions/index.ts`
Gleiche Umstellung: `callGoogleAI` (Zeilen 23-121) ersetzen durch identische Gateway-Funktion. Aufruf in Zeile 292 von `callGoogleAI` auf `callAI` ändern.

### 3. `supabase/functions/pv-automation/index.ts`
Zwei Konstanten anpassen (Zeilen 888-889):
- `ML_CACHE_TTL_MS`: 30 Min → **60 Min** (`60 * 60 * 1000`)
- `SIGNIFICANT_CHANGE_THRESHOLD`: 0.30 → **0.40**

## Effekt
- Kein Google-Free-Tier-Limit (20/Tag) mehr -- unbegrenzte Analysen über Lovable AI Gateway
- Automatische Aufrufe aus pv-automation sinken von ~24-48/Tag auf ~12-15/Tag (spart Gateway-Credits)
- Manuell ausgelöste Analysen (Tagesmuster etc.) funktionieren jederzeit

