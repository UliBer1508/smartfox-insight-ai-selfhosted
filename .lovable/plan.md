# Tuya Service v2.0 lokal aktivieren

## Was hier in Lovable passiert

### 1. Migration: Tabelle `service_health`
Neue Tabelle für Health-Checks lokaler Services (Tuya, Fronius etc.):

```sql
CREATE TABLE public.service_health (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name        text UNIQUE NOT NULL,
  last_sync           timestamptz,
  sync_count          integer DEFAULT 0,
  last_error_count    integer DEFAULT 0,
  devices_configured  integer DEFAULT 0,
  devices_ok          integer DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_service_health_name ON public.service_health(service_name);

ALTER TABLE public.service_health ENABLE ROW LEVEL SECURITY;
```

**RLS-Policies** (passend zu eurem Schema, NICHT permissiv wie im Upload-SQL):
- `authenticated` → ALL (auth.uid() IS NOT NULL)
- `anon` → INSERT, UPDATE, SELECT (für lokalen Tuya-Service mit Anon-Key, analog zu `api_errors` und `rooms`)

### 2. Memory `mem://deployment/tuya-local-service-implementation` aktualisieren
Auf v2.0 erweitern:
- Secrets aus `.env` (nicht mehr in `config.json`)
- Auto-Versionserkennung v3.3/v3.5 via `snapshot.json`
- DB-Retry mit exponentiellem Backoff (3×)
- Health-Check schreibt nach `service_health`
- `auto-discovery.js` parallel scant Port 6668
- `generate-config.js` bezieht Räume aus DB

## Was NICHT geändert wird
- `local-collector/collector-node/` bleibt komplett unangetastet
- Keine Edge-Functions
- Kein UI

## Lokale Aktivierung (auf deinem PC)

```cmd
cd C:\...\tuya-thermostat-v2
npm install
copy .env.example .env
notepad .env                  :: SUPABASE_ANON_KEY eintragen
node auto-discovery.js
node generate-config.js
npm start
```

⚠️ Vorher Tuya-Teil im alten `collector-node` stoppen, sonst doppelte Steuerung.
