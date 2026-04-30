## Problem

`tuya_api_quota` in der DB steht auf `today=2026-04-29, calls_this_month=3886/3000` — der Tages- und Monats-Reset hat nie stattgefunden. Folge: Cloud-Quota dauerhaft als „erschöpft" markiert → keine Tuya-Calls → keine Frostschutz-Pushes → Räume bleiben auf Tag-Sollwerten.

Root Cause im Code (`pv-automation/index.ts` Zeile 468-475): Reset-Logik existiert, aber wenn die Quota direkt danach als erschöpft erkannt wird (Zeile 506), läuft die Funktion in den Quiet Mode und schreibt den genullten Counter NIE in die DB zurück. Der Reset-Effekt ist somit nur in-memory und geht beim nächsten Aufruf verloren.

## Fix in 4 Schritten

### 1. Sofort-Reset (DB-Migration)

Einmaliges UPDATE auf `system_settings.tuya_api_quota`:
- `calls_today = 0`
- `calls_this_month = 0`
- `today = '2026-04-30'`
- `month = '2026-04'`

Damit kann die Cloud-Steuerung sofort wieder Pushes ausführen.

### 2. Code-Fix `supabase/functions/pv-automation/index.ts`

Im Quota-Block (Zeile 462–512): Reset direkt nach Roll-Over **sofort persistieren**, bevor die Erschöpft-Prüfung läuft. So bleibt das Henne-Ei-Problem nie wieder hängen.

### 3. pg_cron Sicherheitsnetz

Täglicher Cron um **00:05 Wien (22:05 UTC)** und monatlicher Cron am 1. um **00:10 Wien**:
```sql
UPDATE system_settings
SET value = jsonb_set(jsonb_set(value, '{calls_today}', '0'),
            '{today}', to_jsonb(to_char(now() AT TIME ZONE 'Europe/Vienna', 'YYYY-MM-DD')))
WHERE key = 'tuya_api_quota';
```

Garantiert Reset auch wenn `pv-automation` gerade nicht läuft.

### 4. Lokaler Service — kurze Diagnose

130 pending commands in DB, aber jüngster ist vom 25.04. (controlMode war Cloud, also normal dass nichts neues kam). Nach Cloud-Fix sollte Service nicht mehr nötig sein. Falls doch: Cleanup der alten pending commands + separater Check ob Service läuft.

## Technische Details

**Files:**
- `supabase/functions/pv-automation/index.ts` — Reset-Persistierung einbauen (Zeile 468-475)
- DB-Migration für Sofort-Reset und 2 pg_cron-Jobs

**Erwartetes Verhalten nach Fix:**
- Räume werden binnen 2 Min auf korrekten Sollwert gepusht (heute 06:30 → noch Nachtmodus → Frost 5°C für die 8 hängenden Räume)
- Tageswechsel um Mitternacht resettet `calls_today` automatisch
- Monatswechsel resettet `calls_this_month` automatisch
- Reset wird auch ohne erfolgreichen Tuya-Call persistiert
