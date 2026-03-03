

# KI-Kosten vermeiden: Lovable AI Fallback entfernen

## Aktueller Zustand

Die Edge Function `analyze-patterns` ist die **einzige** Funktion, die KI-Aufrufe macht. Sie hat zwei Provider:

1. **Google AI (Primaer)**: Ruft `generativelanguage.googleapis.com` direkt mit dem `GOOGLE_AI_API_KEY` auf -- das ist dein eigener Google AI Studio Key (kostenlos im Free-Tier mit Ratenlimit).
2. **Lovable AI Gateway (Fallback)**: Wenn Google fehlschlaegt, wird automatisch `ai.gateway.lovable.dev` aufgerufen. **Dieser Fallback verursacht Lovable AI Kosten.**

## Loesung

Den Lovable AI Fallback in `analyze-patterns/index.ts` komplett entfernen:

1. **`callLovableAI()` Funktion loeschen** (Zeilen 147-181)
2. **`callAI()` Funktion vereinfachen**: Nur noch Google AI aufrufen, bei Fehler eine klare Fehlermeldung zurueckgeben statt auf Lovable AI auszuweichen
3. **Fehlerbehandlung**: Wenn Google AI fehlschlaegt (z.B. Rate-Limit), wird ein Fehler zurueckgegeben statt kostenpflichtig weiterzuleiten

Dadurch entstehen keine Kosten mehr fuer Lovable AI. Der `LOVABLE_API_KEY` bleibt als System-Secret bestehen (kann nicht geloescht werden), wird aber nicht mehr verwendet.

