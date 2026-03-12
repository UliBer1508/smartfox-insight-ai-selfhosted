

# Problem: Cron-Job ruft falsche URL auf

## Ursache

Der pg_cron-Job `pv-automation-check` ruft `POST /functions/v1/pv-automation` auf. Die Funktion extrahiert den Sub-Pfad mit `path = url.pathname.replace('/pv-automation', '')`, was zu `path = ''` (leer) führt. Der Handler prüft `if (path === '/check')` — das matcht nie. Der Request fällt bis Zeile 1527 durch und gibt `404 Not found` zurück. **Keine Logs, keine Nacht-Korrektur.**

Die Thermostate behalten ihre alten `target_temp` Werte (19°C) und heizen autonom, obwohl `night_temp` 18°C ist.

Mein manueller Aufruf an `/pv-automation/check` hat sofort 8 Räume korrigiert — die Logik funktioniert, nur der Cron erreicht sie nicht.

## Fix

Den Cron-Job aktualisieren: URL von `/functions/v1/pv-automation` auf `/functions/v1/pv-automation/check` ändern.

```sql
SELECT cron.alter_job(
  job_id := 1,
  command := $$
  select net.http_post(
    url:='https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/pv-automation/check',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

Alternativ: Die Funktion so ändern, dass `path === ''` auch den `/check`-Handler triggert (robuster, da dann beides funktioniert).

## Empfohlener Ansatz

**Beides**: In der Funktion `path === '' || path === '/check'` akzeptieren UND den Cron-Job auf die korrekte URL umstellen. So ist es zukunftssicher.

