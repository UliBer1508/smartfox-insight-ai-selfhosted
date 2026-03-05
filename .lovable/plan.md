

# Fix: Cron-Jobs verwenden Anon-Key, Auth erwartet Service-Role-Key

## Problem

Die Cron-Jobs (pg_cron) senden den **Anon-Key** als Bearer-Token. Die Auth-Logik in den Edge Functions prüft aber ob der Token dem **Service-Role-Key** entspricht. Der Anon-Key ist weder der Service-Role-Key noch ein gültiger User-JWT → 401 bei jedem Cron-Aufruf.

Das erklärt warum die Daten seit dem 3. März stehen geblieben sind.

## Lösung

Zwei Optionen - ich empfehle **Option A** (einfacher, kein Cron-Umbau nötig):

### Option A: Auth-Logik erweitern - auch Anon-Key akzeptieren

In allen 4 Edge Functions die Auth-Prüfung so anpassen, dass **sowohl** Service-Role-Key **als auch** Anon-Key als interne Aufrufe akzeptiert werden:

```typescript
const token = authHeader.replace('Bearer ', '');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

// Service role key OR anon key = internal/Cron call → allowed
if (token !== serviceRoleKey && token !== anonKey) {
  // Validate as user JWT
  const { data, error } = await authClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return 401;
}
```

### Betroffene Dateien

1. `supabase/functions/pv-automation/index.ts` (Zeilen 329-344)
2. `supabase/functions/apply-recommendations/index.ts`
3. `supabase/functions/tuya-control/index.ts`
4. `supabase/functions/analyze-patterns/index.ts`

Gleiche Änderung in allen 4 Funktionen: Anon-Key zusätzlich als erlaubten internen Token akzeptieren.

**Hinweis:** Da `verify_jwt = false` in config.toml gesetzt ist und die Funktionen bereits eigene Auth-Prüfung machen, ist dies sicher - der Anon-Key allein gewährt keinen Datenzugriff, die Funktionen verwenden intern den Service-Role-Key für DB-Operationen.

