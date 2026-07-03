# Fix-Dokumentation: record-pv-accuracy Cron & Ergebnis-Watchdog

**Datum:** 3. Juli 2026 (Morgen-Session)
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** pg_cron Job 23 (`record-pv-accuracy-daily`), neuer pg_cron Job 25 (`pv-accuracy-watchdog`), Tabelle `pv_forecast_accuracy`

**Zusammenfassung:** Die am 01.07. gebaute PV-Prognose-Erfassung (`record-pv-accuracy`,
Cron 23:30 Wien) hat zwei Nächte lang KEINE Daten geschrieben, obwohl `cron.job_run_details`
beide Läufe als `succeeded` meldete. Ursache: Im Cron-Command stand der Platzhalter
`DEIN_ANON_KEY` statt des echten anon_keys → jeder Aufruf lief in einen stillen 401.
Fix per SQL (Key aus Job 16 kopiert), verifiziert. Zusätzlich wurde ein Ergebnis-Watchdog
(Job 25, reines SQL, keine Keys) gebaut, der künftig solche stillen Ausfälle im
ApiErrorBanner sichtbar macht.

---

## Problem — record-pv-accuracy schrieb zwei Nächte nichts  ✅ GELÖST

### Symptom
- Dashboard-Karte „PV-Prognose vs. Realität": „Noch keine Genauigkeitsdaten vorhanden".
- `pv_forecast_accuracy` enthielt nur den Mittagstest vom 01.07. (actual 3.67 kWh, 1000 samples).
- Nachtläufe vom 01.07. und 02.07. fehlten komplett.
- ABER: `cron.job_run_details` für Job 23 zeigte beide Läufe als `succeeded`.

### Kernerkenntnis (WICHTIG für alle künftigen Diagnosen)
**`succeeded` in `cron.job_run_details` heißt nur „net.http_post wurde abgeschickt"** —
NICHT, dass die Edge Function erfolgreich war. Ein 401/500 der Function ist für pg_cron
trotzdem ein „erfolgreicher" SQL-Lauf. Die HTTP-Antwort steht in `net._http_response`
(unzuverlässig bei vielen parallelen Jobs) bzw. in den Edge-Function-Logs.

### Diagnose-Weg (zur Wiederverwendung)
```sql
-- 1) Ist-Stand der Zieltabelle
select date, forecast_kwh, actual_kwh, ratio, samples, created_at
from pv_forecast_accuracy order by date desc;

-- 2) Lief der Cron überhaupt?
select runid, status, return_message, start_time
from cron.job_run_details where jobid = 23
order by start_time desc limit 5;
-- Ergebnis: succeeded / succeeded — aber Tabelle leer → Widerspruch

-- 3) Cron-Command ansehen (DER entscheidende Blick)
select left(command, 400) from cron.job where jobid = 23;
-- Ergebnis: 'apikey','DEIN_ANON_KEY'  ← URSACHE gefunden
```

### Ursache
Beim Anlegen von Job 23 (Session 01.07.) wurde der Platzhalter `DEIN_ANON_KEY` aus der
Vorlage NICHT durch den echten Key ersetzt. Gleicher Fehlertyp wie der große
anon_key-Cron-Fix vom 30.06. (`FIX-ANON-KEY-UND-ANALYZE-PATTERNS-2026-06-30.md`),
nur diesmal beim Neu-Anlegen übersehen.

### Fix — SQL-Editor-Fallen umgangen
Direkte `cron.alter_job(23, command := $$...$$)`-Versuche mit dem langen JWT scheiterten
ZWEIMAL am SQL-Editor: Er hängt seine Metadaten/`limit 100` mitten in den langen
Key-String („unterminated dollar-quoted string"), auch mit „No limit".

**Lösung: Key gar nicht einfügen, sondern aus einem funktionierenden Job kopieren.**
Job 16 (`fetch-pv-forecast`) hat den echten Key bereits hartkodiert:

```sql
-- Key-Extraktion prüfen (JWTs beginnen immer mit eyJ)
select substring(command from 'eyJ[A-Za-z0-9_.-]+') as key
from cron.job where jobid = 16;   -- lieferte den echten anon_key ✓

-- Platzhalter in Job 23 ersetzen
select cron.alter_job(
  23,
  command := replace(
    (select command from cron.job where jobid = 23),
    'DEIN_ANON_KEY',
    (select substring(command from 'eyJ[A-Za-z0-9_.-]+') from cron.job where jobid = 16)
  )
);

-- Kontrolle: Platzhalter weg?
select position('DEIN_ANON_KEY' in command) from cron.job where jobid = 23;
-- Ergebnis: 0 ✓
```
> Hinweis: Erster Versuch mit Muster `'Bearer ([^'']+)'` schlug fehl
> („no updates specified" = replace ergab NULL). Das `eyJ...`-Muster ist robuster.

### Verifikation
Manueller Testlauf über Supabase-Dashboard (Edge Functions → record-pv-accuracy →
Test, Body `{}`) — Antwort 200:
```json
{ "ok": true, "date": "2026-07-03", "forecast_kwh": 32.8,
  "actual_kwh": 0.52, "ratio": 0.016, "samples": 941 }
```
Zeile in `pv_forecast_accuracy` bestätigt. (0.52 kWh korrekt — früher Morgen;
der Nachtlauf 23:30 überschreibt per Upsert mit dem vollen Tageswert.)

### Datenbereinigung
- Alt-Eintrag 01.07. (3.67 kWh Mittagstest, nie korrigiert) gelöscht — hätte das
  spätere Faktor-Lernen verzerrt (ratio 0.108 sah aus wie extremer Prognosefehler,
  war aber nur ein halber Tag).
- Nächte 01.07. + 02.07. als Datenpunkte bewusst aufgegeben (Backfill wäre über die
  7-Tage-Retention noch möglich gewesen; bei 2 von geplanten 365 Punkten nicht lohnend
  — „die lange Reihe zählt").

---

## Neu — Ergebnis-Watchdog (Job 25)  ✅ LIVE & GETESTET

### Motivation
Die blinde Stelle schließen: Ein Cron kann „succeeded" melden und trotzdem nichts
bewirken. Der Watchdog prüft das ERGEBNIS (Zeile in der Zieltabelle), nicht den Aufruf.

### Design-Entscheidung
Reiner SQL-Cron, KEINE Edge Function, KEIN `net.http_post` → braucht keine Keys →
die gesamte anon_key-Fehlerklasse (Platzhalter, 401) kann hier prinzipiell nicht
auftreten. Meldekanal ist `api_errors` → erscheint automatisch im vorhandenen
ApiErrorBanner des Dashboards.

### Angelegt
```sql
select cron.schedule(
  'pv-accuracy-watchdog',
  '0 6 * * *',  -- 06:00 UTC = 08:00 Wien (Sommer); Winter 07:00 Wien
  $$
  insert into api_errors (source, error_type, error_message)
  select 'pv-accuracy-watchdog', 'fetch_failed',
         'record-pv-accuracy: kein gültiger Eintrag für ' || (current_date - 1)::text
  where not exists (
    select 1 from pv_forecast_accuracy
    where date = current_date - 1
      and samples > 500
  );
  $$
);
-- → Job 25
```
Logik: Existiert für GESTERN eine Zeile mit > 500 Samples (= Nachtlauf über den ganzen
Tag, nicht nur ein Test), passiert nichts. Sonst Banner-Meldung.

### Live-Test (bestätigt)
Insert-Teil manuell ausgeführt — da für den 02.07. tatsächlich kein Eintrag existierte,
schlug der Watchdog korrekt an:
```
2026-07-03 05:55 UTC | pv-accuracy-watchdog | kein gültiger Eintrag für 2026-07-02
```
Test-Meldung danach aufgelöst (`update api_errors set resolved_at = now() where
source = 'pv-accuracy-watchdog' and resolved_at is null;` → count offener = 0).

---

## Tagesablauf der Kette (Soll-Zustand ab 03.07.)

| Zeit (Wien, Sommer) | Job | Aktion |
|---|---|---|
| 06/09/12/15 Uhr | 16 | `fetch-pv-forecast` aktualisiert Tagesprognose |
| 23:30 | 23 | `record-pv-accuracy` schreibt Prognose-vs-Ist des Tages |
| 08:00 (Folgetag) | 25 | Watchdog prüft gestrigen Eintrag, meldet Fehlen im Banner |

---

## LEHREN (Ergänzung zu den bestehenden Regeln)

1. **Nach JEDEM `cron.schedule` sofort den Command kontrollieren:**
   `select command from cron.job where jobid = X;` — ein Platzhalter fällt dann
   sofort auf statt zwei Nächte später. (Zweiter Fall dieses Fehlertyps nach 30.06.)
2. **`succeeded` in `cron.job_run_details` beweist NICHTS über die Edge Function** —
   nur dass das SQL lief. Ergebnis immer in der Zieltabelle prüfen.
3. **Lange JWTs lassen sich im SQL-Editor praktisch nicht einfügen** (Editor hängt
   Metadaten/limit mitten in den String, auch bei „No limit"). Workaround: Key per
   `substring(command from 'eyJ[A-Za-z0-9_.-]+')` aus einem funktionierenden Job
   kopieren statt einfügen.
4. **Watchdogs als reines SQL bauen** (kein http_post) — immun gegen die
   Key-Fehlerklasse und ohne neue Abhängigkeiten.
5. Perspektive: Dasselbe Muster kann später auf weitere Nacht-Jobs ausgeweitet werden
   (generischer Watchdog, der mehrere Jobs auf erwartete Tabellen-Ergebnisse prüft).

---

## pg_cron-Stand nach dieser Session (relevante Jobs)

| Job | Name | Schedule (UTC) | Status |
|---|---|---|---|
| 16 | fetch-pv-forecast-daily | `0 4,7,10,13 * * *` | unverändert, Key-Quelle für Fix |
| 23 | record-pv-accuracy-daily | `30 21 * * *` | **repariert** (echter Key statt Platzhalter) |
| 25 | pv-accuracy-watchdog | `0 6 * * *` | **neu**, reines SQL |

---

## Kontrollblick morgen früh (04.07., nach ~8 Uhr Wien)

```sql
-- 1) Voller Tageswert für 03.07. geschrieben?
select date, forecast_kwh, actual_kwh, ratio, samples
from pv_forecast_accuracy order by date desc;
-- Erwartung: 03.07. mit ~60-78 kWh (bei Sonne), samples deutlich > 1000,
--            ratio ~1.5-2.4 (Prognose 32.8 liegt vermutlich wieder unter Realität)

-- 2) Watchdog still geblieben? (kein offener Eintrag = alles gut)
select count(*) from api_errors
where source = 'pv-accuracy-watchdog' and resolved_at is null;
-- Erwartung: 0

-- Dashboard: Karte „PV-Prognose vs. Realität" zeigt ersten Punkt.
```
