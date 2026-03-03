

# Fix: Cron-Job Auth fuer pv-automation und apply-recommendations

## Problem

Beim letzten Security-Fix wurde JWT-Authentifizierung zu `pv-automation` und `apply-recommendations` hinzugefuegt. Diese Funktionen werden aber auch von **Cron-Jobs** aufgerufen, die den **Service-Role-Key** verwenden -- keinen User-JWT. `getClaims()` findet kein `sub` im Service-Role-Key und gibt 401 zurueck.

Ergebnis: `pv-automation/check` schlaegt seit dem 27. Februar bei **jedem Aufruf** fehl. Keine neuen KI-Entscheidungen, keine Temperatur-Updates.

## Loesung

Die Auth-Logik in beiden Funktionen anpassen, sodass **sowohl** User-JWTs **als auch** der Service-Role-Key akzeptiert werden:

1. **Service-Role-Key Erkennung**: Pruefen ob der Bearer-Token dem `SUPABASE_SERVICE_ROLE_KEY` entspricht. Falls ja, Auth ueberspringen (Cron-Job / interner Aufruf).
2. **User-JWT Validierung**: Falls der Token nicht der Service-Role-Key ist, weiterhin `getClaims()` pruefen (Frontend-Aufrufe).

### Betroffene Dateien

1. **`supabase/functions/pv-automation/index.ts`** (Zeilen 319-341)
   - Service-Role-Key Check vor getClaims einfuegen

2. **`supabase/functions/apply-recommendations/index.ts`** (Zeilen ~205-220)
   - Gleiche Logik

3. **`supabase/functions/tuya-control/index.ts`** -- ebenfalls pruefen, da auch per Cron aufgerufen

4. **`supabase/functions/analyze-patterns/index.ts`** -- ebenfalls pruefen

### Technisches Detail

```typescript
// Neue Auth-Logik (Pseudocode):
const token = authHeader.replace('Bearer ', '');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Service role key = interner/Cron Aufruf → erlaubt
if (token === serviceRoleKey) {
  // Skip user validation, proceed with service role client
} else {
  // Validate as user JWT
  const { data, error } = await authClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return 401;
}
```

Dies stellt die KI-Steuerung wieder her, ohne die Security-Verbesserung fuer Frontend-Aufrufe zu verlieren.

