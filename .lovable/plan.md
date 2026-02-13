
# Cron-Job für update-learned-policies implementieren

## Status
Die Edge Function `update-learned-policies` ist bereits implementiert und konfiguriert (in `supabase/config.toml` unter `[functions.update-learned-policies]`). Sie ist einsatzbereit und kann manuell aufgerufen werden.

Was noch fehlt: Ein **automatisiertes tägliches Trigger-System** um die Funktion regelmäßig aufzurufen.

## Plan

### Schritt 1: SQL-Migration für pg_cron
Die `pg_cron` Extension muss in der Datenbank aktiviert sein, um Cron-Jobs zu erstellen. Dies wird über eine SQL-Migration durchgeführt:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule update-learned-policies to run daily at 19:30 UTC
-- (Das ist 20:30 oder 21:30 Vienna Zeit, je nach Sommerzeit)
SELECT cron.schedule(
  'update-learned-policies-daily',
  '30 19 * * *',  -- Every day at 19:30 UTC
  $$
    SELECT net.http_post(
      url := 'https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/update-learned-policies',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cW1oZHBjaXhrZnN1ZHh1Z2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NjAxODQsImV4cCI6MjA4MTMzNjE4NH0.3WDZXuxGECexP_wjvmK5QTFvJakMW2-SLs7FRzxoFKI", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

### Schritt 2: Ausführungsablauf
1. **19:30 UTC täglich**: Der Cron-Job wird ausgelöst
2. **HTTP POST Request**: Ruft die `update-learned-policies` Edge Function auf
3. **Datenbankupdate**: Die Funktion aggregiert alle `learning_events` aus den letzten 30 Tagen
4. **Policies aktualisieren**: Upserts die `learned_policies` Tabelle mit aktuellen Best-Actions und Reward-Statistiken
5. **pv-automation nutzt Policies**: Im nächsten Automation-Run greift die `pv-automation` Funktion auf die aktualisierten Policies zu

### Schritt 3: Zeitzone und Timing
- **19:30 UTC** = **20:30 Wien** (Winter, UTC+1) oder **21:30 Wien** (Sommer, UTC+2)
- Timing ist bewusst gewählt: Nach Sonnenuntergang (~17:00 Wien), genug Zeit um die letzten Learning Events zu evaluieren, aber vor der Nacht-Heizphase
- Falls optimal, kann die Zeit später angepasst werden (z.B. 18:00 UTC für 19:00/20:00 Wien)

### Schritt 4: Monitoring
Nach Implementierung können die Cron-Job-Runs überwacht werden via:
- Edge Function Logs: Jeder Ausführung wird geloggt
- `learned_policies` Tabelle: `updated_at` Spalte zeigt wann Policies zuletzt aktualisiert wurden
- `learning_events` Tabelle: Neue Events werden fortlaufend eingetragen

## Dateiänderungen
1. **Neue Migration**: Erstelle SQL-Datei mit `CREATE EXTENSION pg_cron` und `cron.schedule()` Call
2. **Keine Code-Änderungen**: Die Edge Function und die pv-automation Integration sind bereits implementiert

## Wartezeit
Nach dem Deployment:
- Cron-Job ist sofort aktiv
- Erste Ausführung: Heute um 19:30 UTC
- Danach täglich um 19:30 UTC
- Die ersten Policies werden sichtbar in der `learned_policies` Tabelle (frühestens morgen nach dem ersten Cron-Run)
