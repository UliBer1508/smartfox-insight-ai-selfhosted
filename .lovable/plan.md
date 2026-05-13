## Ziel
Die 3 stehenden Banner-Fehler (Waschraum `local_service_offline`, Heartbeat `no_control_channel`, Haustür `connection_error` 09.05.) verschwinden dauerhaft, ohne dass echte Fehler maskiert werden. Setpoint-Logik (`pv-automation`) und Control-Mode (`local`) bleiben unangetastet.

## Umsetzung (3 Bausteine)

### A — Heartbeat-Fix (keine neuen Fehlalarme)
Datei: `supabase/functions/automation-heartbeat/index.ts` (bzw. der Code-Pfad, der `no_control_channel` / `local_service_offline` schreibt).

- Single Source of Truth für „Local Service lebt" = `service_health.last_sync` für `service_name = 'tuya-thermostat'`.
- Schwelle: `last_sync` älter als **5 min** → offline. Sonst: kein Fehler eintragen, auch wenn `last_local_command_at` älter ist (das ist normal in Komfort-Sättigung / Nacht / Pause).
- Pro Raum: `connection_error` nur loggen, wenn ein **konkreter Command** in den letzten 30 min `failed`/`expired` ist — nicht aus Inaktivität ableiten.

### B — Auto-Resolver (Selbstheilung)
Neue Edge Function `supabase/functions/auto-resolve-api-errors/index.ts` + `pg_cron` alle 5 min.

Setzt `resolved_at = now()` für unresolved `api_errors`, wenn die Ursache nachweislich weg ist:
- `local_service_offline`, `no_control_channel`, `night_frost_failed` → wenn `service_health.last_sync` < 5 min alt.
- `connection_error` (raumbezogen) → wenn der Raum in den letzten 30 min einen `executed` Command hat **oder** der Fehler älter als 2 h und kein neuer Fehler dazugekommen ist.
- Sicherheitsnetz: alle unresolved Fehler älter als 24 h → `resolved_at = now()` mit Hinweis im Log (verhindert Banner-Müll).

Cron via `supabase--insert` (nicht Migration), Auth: lokales JWT-Decoding wie bei anderen Triggern.

### C — Einmal-Cleanup
SQL via `supabase--insert`:
```sql
UPDATE api_errors SET resolved_at = now()
WHERE resolved_at IS NULL AND created_at < now() - interval '1 hour';
```
Banner ist sofort leer.

## Out of Scope
- `pv-automation` Setpoint-Logik
- `tuya_control_mode` (bleibt `local`, kein Auto-Failover)
- Local Collector / LAN-Service
- UI-Filter im `ApiErrorBanner` (nicht nötig, da B+C die Quelle sauber halten)

## Memory-Updates nach Implementierung
- Neue Leaf: `mem://features/heating/api-error-auto-resolve` (Resolver-Regeln + Cron-Intervall)
- Update: `mem://features/heating/api-error-reporting` (Heartbeat nutzt `service_health.last_sync`, 5 min Schwelle)
- Update: `mem://features/heating/api-error-visibility` (Selbstheilung statt manuellem Acknowledge)
- Update: `mem://index.md` Memories-Sektion

## Verifikation nach Deploy
1. `SELECT * FROM api_errors WHERE resolved_at IS NULL` → erwartet: leer
2. Heartbeat 1× manuell triggern → erwartet: kein neuer Eintrag bei gesundem `service_health`
3. Cron-Job in `cron.job` sichtbar, nächster Run < 5 min
