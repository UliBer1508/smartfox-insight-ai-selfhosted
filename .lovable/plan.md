

## Plan: analyze-patterns von Lovable AI auf Google Gemini umstellen

### Problem
Die Edge Function `analyze-patterns` ist die **einzige** Funktion, die noch den Lovable AI Gateway (`ai.gateway.lovable.dev` + `LOVABLE_API_KEY`) verwendet. Alle anderen Functions (z.B. `generate-settings-suggestions`) nutzen bereits Google Gemini direkt über `GOOGLE_AI_API_KEY`. Da die Lovable-Credits erschöpft sind (402-Fehler), funktioniert die KI-Analyse nicht.

### Lösung

**Datei: `supabase/functions/analyze-patterns/index.ts`** — `callAI`-Funktion (Zeilen 26-69) ersetzen

Die bestehende Implementierung aus `generate-settings-suggestions` 1:1 übernehmen:

1. **API-Key**: `LOVABLE_API_KEY` → `GOOGLE_AI_API_KEY`
2. **URL**: `ai.gateway.lovable.dev/v1/chat/completions` → `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
3. **Request-Format**: OpenAI-Stil → Gemini-Stil (messages → contents/parts, system → systemInstruction, tools → functionDeclarations)
4. **Response-Konvertierung**: Gemini-Response (`candidates[0].content.parts`) wird in OpenAI-kompatibles Format umgewandelt (`choices[0].message`), damit der gesamte nachgelagerte Parsing-Code (Zeilen 798-850) unverändert funktioniert

**Zusätzlich**: Kommentar am Dateianfang aktualisieren: `AI PROVIDER: Google Gemini (direkt)` statt `Lovable AI Gateway`

### Keine weiteren Änderungen nötig
- `generate-settings-suggestions` nutzt bereits Gemini direkt
- Alle anderen Edge Functions (`pv-automation`, `evaluate-decision` etc.) machen keine eigenen AI-Calls
- Der Frontend-Code referenziert nirgends Lovable AI

### Betroffene Datei
- `supabase/functions/analyze-patterns/index.ts` — Zeilen 7-69 (Provider-Kommentar + callAI-Funktion)

