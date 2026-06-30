# Fix-Dokumentation: PV-Heizoptimierung, Energiedaten & Lernsystem

**Datum:** 30. Juni 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** `heating_settings`, `fetch-pv-forecast`, `pv-automation`, `ai-parameter-advisor`, `ai-daily-planner`, `compute-daily-score`, RPC `get_weekly_energy_summary`, `smartfox-collector/index.js`, pg_cron

**Zusammenfassung:** Diese (lange) Sitzung deckte und behob die **eigentliche Wurzel** dafür auf, dass die PV-Heizoptimierung und das Lernsystem nicht sinnvoll funktionierten. Es waren mehrere unabhängige Probleme, die sich überlagerten. Der wichtigste Fund: eine leere `heating_settings`-Tabelle (machte die gesamte vorausschauende Logik blind) und ein hartcodierter `energy_in=0`/`energy_out=0`-Bug im Collector (machte alle Eigenverbrauchs-/Score-Werte zu 0). Beide sind jetzt (bzw. per Näherung) behoben.

---

## WICHTIGER WORKFLOW-HINWEIS (vorab, gilt für alles weitere)

**GitHub-Commits gehen NICHT automatisch live.** Es gibt keine CI/CD-Pipeline GitHub → Supabase. Eine Edge Function wird erst aktiv, wenn jemand `supabase functions deploy <name>` ausführt. Code im Repo zu ändern „repariert" den laufenden Server NICHT.

- DB-Änderungen (SQL: Tabellen, RPCs, Cron, Seeds) wirken **sofort**, kein Deploy nötig.
- Edge-Function-Code-Änderungen brauchen **immer** ein manuelles Deploy.
- In Österreich liegen nur die zwei Collector-Ordner (`smartfox-collector`, `tuya-thermostat`), **NICHT** das Repo mit den Edge Functions. Wo/wie die Functions deployt werden, muss noch geklärt werden (Deploy-Rechner mit CLI + geklontem Repo nötig).

---

## Problem 1 — leere `heating_settings` (Hauptursache der blinden Heizautomatik) ⭐

### Symptom
Heizung optimiert nicht PV-bewusst. `pv-automation` bleibt passiv. Lern-/Analysekette läuft nicht. `forecast_heute = 0` (keine PV-Prognose).

### Ursache
Die Tabelle `heating_settings` hatte **keine einzige Zeile**. Bei der Migration wurde die Struktur, aber keine Zeile übernommen (gleiches Muster wie `ai_parameter_whitelist`). Praktisch jede Funktion liest aus `heating_settings`:
- `fetch-pv-forecast` braucht `latitude/longitude/roof_azimuth/roof_declination/pv_capacity_kwp` → ohne Zeile kaputte URL → keine Prognose
- `pv-automation` liest dutzende Schwellwerte → ohne Zeile nur Code-Defaults
- `analysis-scheduler` steigt aus mit `no heating_settings` → Lernkette tot

### Fix
Die Tabelle hat für jede Spalte sinnvolle Defaults (inkl. korrekter Anlagenwerte: PV 15.8 kWp, Batterie 13.8 kWh, lat 47.24983 / lon 12.25415, Neigung 35°, Azimut 0 = Süd, `direct_electric`). Daher genügte:
```sql
INSERT INTO public.heating_settings DEFAULT VALUES;
```

### Verifikation
```sql
select latitude, longitude, roof_azimuth, roof_declination, pv_capacity_kwp,
       heating_min_battery_soc, night_end_time, floor_heating_response_hours
from heating_settings limit 1;
```
**Bestätigt:** 47.24983 / 12.25415 / 0 / 35 / 15.8 / 80 / 06:00:00 / 2.

---

## Problem 2 — PV-Prognose fehlte (`forecast_heute = 0`)

### Ursache
Folgefehler aus Problem 1: ohne Geo-/Anlagendaten konnte `fetch-pv-forecast` (zieht von Forecast.Solar, kostenlos, kein Key) keine gültige URL bauen.

### Fix
Nach dem `heating_settings`-INSERT die Prognose manuell angestoßen (anon_key statt `app.anon_key`, da letzteres im SQL-Editor nicht gesetzt ist):
```sql
select net.http_post(
  url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/fetch-pv-forecast',
  headers := jsonb_build_object('Content-Type','application/json','apikey','DEIN_ANON_KEY','Authorization','Bearer DEIN_ANON_KEY'),
  body := '{}'::jsonb
) as request_id;
```

### Verifikation
```sql
select date, expected_kwh, sunrise, sunset, fetched_at from pv_forecasts order by date desc limit 4;
```
**Bestätigt:** 30.06. = 46 kWh, 01.07. = 34.5 kWh, sunrise/sunset gefüllt.

### Hinweis
Forecast.Solar Gratis-API hat striktes Rate-Limit. Bei `429` einfach auf den nächsten Cron-Lauf (6:00 Wien) warten.

---

## Problem 3 — `pv-automation` lief, aber Komfort-Budget = 0 (im Hochsommer korrekt)

### Beobachtung
Nach Fix 1+2 läuft die `pv-automation` vollständig durch (Logs zeigen pro Raum echte Entscheidungen: `PV-HEIZEN ✅ Eco erreicht`, `BUDGET-PAUSE Estrich-Speicher aktiv`). `comfortBudget=0W` ist hier **kein Bug**: alle Räume sind im Hochsommer längst warm (23–26°C), kein Heizbedarf. Vorausschauende Logik (Vorheizen) ist jetzt wieder aktiv, greift aber real erst bei Heizbedarf (Winter).

---

## Problem 4 — KI-Autopilot: leere Whitelist + Locked/Auto-Widerspruch

### Symptom
„Letzter Lauf —", „Auto heute 0", `ai_parameter_decisions` leer.

### Ursache 4a — leere Whitelist (Hauptursache)
`ai_parameter_whitelist` hatte 0 aktive Einträge (Seed bei Migration vergessen). `ai-parameter-advisor` steigt sofort mit `skipped: empty_whitelist` aus.

### Fix 4a — Whitelist seeden
14 Einträge per INSERT … ON CONFLICT eingespielt (siehe separate Doku `FIX-KI-AUTOPILOT-TAGESPLANER-2026-06-30.md`, Problem 3). Ergebnis: 14 aktive Einträge.

### Ursache 4b — `auto`-Parameter stehen auch in `LOCKED_PARAMS` (Code)
Widerspruch: die 3 `auto`-Parameter (`pv_surplus_threshold_on/off`, `night_start_time`) sind im Code hart gesperrt → „Auto heute" bliebe 0.

### Fix 4b — Weg B: auf `suggest` zurückstufen
```sql
UPDATE ai_parameter_whitelist SET autonomy_level = 'suggest'
WHERE parameter_key IN ('pv_surplus_threshold_on','pv_surplus_threshold_off','night_start_time') AND scope = 'global';
```
Bewusst: frisch migriertes System soll nur Vorschläge machen, nichts autonom schreiben.

---

## Problem 5 — KI-Autopilot: Gemini 429 (Tagesquota)

### Ursache
Nach dem Seed läuft die Funktion durch und ruft Gemini (`gemini-2.5-flash-lite`), bekommt aber HTTP 429 (Free-Tier-Tageslimit aufgebraucht durch zu häufige Aufrufe).

### Fix — Cron ausdünnen (Job 10)
```sql
select cron.alter_job(10, schedule := '0 5-21 * * *');  -- von */15 auf stündlich
```
**TODO morgen (frische Quota ~9–10 Uhr Wien):** „Jetzt analysieren" und prüfen, ob `ai_parameter_decisions` Zeilen bekommt.

---

## Problem 6 — Tagesplaner: Datum & Cron (Code-Fix committed, NICHT deployt)

### Datums-Bug (Code)
`ai-daily-planner/index.ts`, `getTodayVienna()` hatte den Doppel-Cast. Fix committed:
```js
function getTodayVienna(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
}
```
⚠️ **Im Repo, aber NICHT deployt.** Heute lief es trotzdem korrekt (Glück: zur Cron-Zeit 06:40 Wien kippte der alte Cast nicht über Mitternacht).

### Cron (DB, wirkt sofort)
```sql
select cron.alter_job(16, schedule := '0 4 * * *');   -- fetch-pv-forecast 6:00 Wien
select cron.alter_job(15, schedule := '30 4 * * *');  -- ai-daily-planner 6:30 Wien (nach Prognose)
```
**Bestätigt.** Reihenfolge jetzt korrekt: erst Prognose, dann Plan.
**Sommer-/Winterzeit-Vorbehalt:** pg_cron = UTC, kennt keine DST. Im Winter läuft alles 1 h früher (Wien). Kein Datenfehler.

---

## Problem 7 — ⭐ DER GROSSE FUND: `energy_in`/`energy_out` hartcodiert 0

### Symptom
Dashboard „KI-Musteranalyse": Eigenverbrauch 0%, Score 0/100, Heizung aus PV 0%, Netzbezug 0.00 kWh, „Keine Analyse verfügbar". Sehr viele Nullen, mehr als durch fehlende Tage erklärbar.

### Diagnose (breite Abfrage der heutigen Rohdaten)
```sql
select count(*) as messungen,
  round(avg(pv_power)) as avg_pv, round(avg(consumption)) as avg_verbrauch,
  round(avg(power_io)) as avg_power_io,
  round(avg(energy_in),2) as avg_energy_in, round(avg(energy_out),2) as avg_energy_out,
  count(*) filter (where energy_in > 0) as zeilen_mit_netzbezug,
  count(*) filter (where energy_out > 0) as zeilen_mit_einspeisung
from energy_readings where timestamp >= current_date;
```
**Ergebnis:** pv_power/consumption/power_io/battery_soc werden geschrieben ✓ — aber `energy_in` und `energy_out` sind in **0 von 1228** Zeilen befüllt.

### Ursache (im Collector-Code gefunden)
`local-collector/smartfox-collector/index.js`, Funktion `saveReading()`:
```js
const reading = {
  timestamp: new Date().toISOString(),
  power_io: froniusData.grid_power,
  energy_in: 0,          // ← HARTCODIERT 0
  energy_out: 0,         // ← HARTCODIERT 0
  battery_soc: froniusData.battery_soc,
  pv_power: froniusData.pv_power,
  consumption: froniusData.load_power,
  battery_power: froniusData.battery_power
};
```
Der Collector liest vom Fronius-Endpunkt `GetPowerFlowRealtimeData.fcgi` nur **Momentanleistung** (Watt), keine **Zählerstände** (kWh). `energy_in`/`energy_out` werden nie aus echten Daten geschrieben.

### Folge (Kaskade)
Da `energy_in`/`energy_out` überall 0 sind, lieferte auch die RPC `get_weekly_energy_summary` für Netzbezug/Einspeisung 0 → Eigenverbrauchsquote, Score, Heizungs-PV-Anteil, Wochenanalyse **alle** 0. **Eine Wurzel, viele Null-Anzeigen.**

---

## Fix 7a (SOFORT, serverseitig) — RPC repariert: kWh aus `power_io` rekonstruieren

`power_io` (Netzleistung W; positiv = Bezug, negativ = Einspeisung) WIRD zuverlässig geschrieben. Messtakt: **exakt 30 s** (verifiziert: 30.0 s ⌀). Daraus kWh rekonstruierbar: 30-s-Takt = 120 Messungen/h → `SUM(W)/120000 = kWh`.

**Zusätzlich behoben:** Die alte `pv_kwh`-Berechnung teilte durch `60000` (für 60-s-Takt), bei tatsächlich 30 s war **pv_kwh um Faktor 2 zu hoch** (erklärt „91 kWh" statt real ~45). Jetzt `/120000`.

```sql
CREATE OR REPLACE FUNCTION public.get_weekly_energy_summary(days_back integer DEFAULT 7)
 RETURNS TABLE(date date, peak_power numeric, avg_power numeric, energy_in_kwh numeric, energy_out_kwh numeric, feed_in_kwh numeric, pv_kwh numeric, heating_kwh numeric, avg_outdoor_c numeric, reading_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH days AS (
    SELECT generate_series((CURRENT_DATE - (days_back - 1)), CURRENT_DATE, INTERVAL '1 day')::date AS d
  ),
  energy AS (
    SELECT
      (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      MAX(power_io) AS peak_power,
      AVG(power_io) AS avg_power,
      COALESCE(SUM(pv_power) / 120000.0, 0) AS pv_kwh,
      -- 30-Sek-Takt = 120 Messungen/h; positiv = Netzbezug, negativ = Einspeisung
      COALESCE(SUM(GREATEST(power_io, 0)) / 120000.0, 0) AS energy_in_kwh,
      COALESCE(SUM(GREATEST(-power_io, 0)) / 120000.0, 0) AS energy_out_kwh,
      COUNT(*)::integer AS reading_count
    FROM energy_readings
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  ),
  heating AS (
    SELECT (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d,
      COALESCE(SUM(energy_estimate_wh) / 1000.0, 0) AS heating_kwh
    FROM room_heating_logs
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
      AND event_type IN ('heating_stop', 'solar_limit_stop')
    GROUP BY 1
  ),
  weather AS (
    SELECT (timestamp AT TIME ZONE 'Europe/Vienna')::date AS d, AVG(temperature_c) AS avg_outdoor_c
    FROM weather_data
    WHERE timestamp >= (CURRENT_DATE - (days_back - 1)) AT TIME ZONE 'Europe/Vienna'
    GROUP BY 1
  )
  SELECT
    days.d AS date,
    COALESCE(e.peak_power, 0)::numeric,
    COALESCE(e.avg_power, 0)::numeric,
    COALESCE(e.energy_in_kwh, 0)::numeric,
    COALESCE(e.energy_out_kwh, 0)::numeric,
    COALESCE(e.energy_out_kwh, 0)::numeric AS feed_in_kwh,
    COALESCE(e.pv_kwh, 0)::numeric,
    COALESCE(hl.heating_kwh, 0)::numeric,
    w.avg_outdoor_c::numeric,
    COALESCE(e.reading_count, 0)
  FROM days
  LEFT JOIN energy e ON e.d = days.d
  LEFT JOIN heating hl ON hl.d = days.d
  LEFT JOIN weather w ON w.d = days.d
  ORDER BY days.d DESC;
$function$;
```

### Verifikation
```sql
select date, round(pv_kwh,1) pv, round(energy_out_kwh,1) einspeisung, round(energy_in_kwh,2) netzbezug,
  round((pv_kwh - energy_out_kwh)/nullif(pv_kwh,0)*100,1) as eigenverbrauch_prozent
from get_weekly_energy_summary(7) order by date desc;
```
**Bestätigt** — echte, differenzierte Werte, z.B.: 27.06. = 97.1 % Eigenverbrauch, 26.06. = 23.0 %, 29.06. = 37.7 %. pv_kwh jetzt realistisch (29.06. = 45.6 kWh, passt zur Prognose 46).

---

## Fix 7b (SOFORT) — Tagesscores mit echten Werten neu berechnet (per SQL, ohne Edge Function)

Da `compute-daily-score` den nicht-deployten Datums-Bug hat, Scores direkt per SQL aktualisiert:
```sql
WITH summary AS (SELECT * FROM get_weekly_energy_summary(7)),
calc AS (
  SELECT date, pv_kwh, energy_out_kwh AS feed_in_kwh, energy_in_kwh AS grid_import_kwh,
    CASE WHEN pv_kwh > 0 THEN GREATEST(0, LEAST(1, (pv_kwh - energy_out_kwh)/pv_kwh)) ELSE 0 END AS self_consumption_ratio
  FROM summary
)
UPDATE daily_pattern_scores d
SET pv_kwh = c.pv_kwh, feed_in_kwh = c.feed_in_kwh, kpi_grid_import_kwh = c.grid_import_kwh,
    kpi_self_consumption_ratio = c.self_consumption_ratio,
    score = GREATEST(0, LEAST(100,
              (c.self_consumption_ratio * 60) + (COALESCE(d.kpi_pv_heating_coverage,0) * 40)
              - LEAST(20, c.grid_import_kwh * 0.5))),
    updated_at = now()
FROM calc c WHERE d.date = c.date;
```
**Bestätigt** — Scores jetzt differenziert: 27.06.=58 (EV 97%), 28.06.=63, 29.06.=62, 24.–26.06.=13–18 (viel Einspeisung). Score = ehrliche Bewertung statt Null-Hüllen.

**Einordnung:** Niedrige Sommer-Scores sind KORREKT (kein Heizbedarf → viel Einspeisung → niedriger Eigenverbrauch). Der eigentliche Nutzen der Optimierung zeigt sich im Winter. Jetzt existiert das Messinstrument dafür.

---

## Fix 7c (SPÄTER, Österreich) — Collector reparieren: echte Zählerstände schreiben ⚠️ WEG 2

Die RPC-Lösung (7a) ist eine **Näherung** aus Momentanleistung. Die saubere Lösung: Collector schreibt echte kWh.

### Aufgabe am Österreich-PC
Datei: `C:\Users\ulibe\smartfox-collector\index.js` (und Repo-Kopie `local-collector/smartfox-collector/index.js`).

**Option A (empfohlen): echte Fronius-Smartmeter-Zählerstände.**
Zusätzlichen Endpunkt abfragen: `GetMeterRealtimeData.fcgi` (liefert Energiezähler `EnergyReal_WAC_Sum_Consumed` = Bezug, `EnergyReal_WAC_Sum_Produced` = Einspeisung in Wh). Diese in `energy_in`/`energy_out` schreiben statt `0`.
- **Voraussetzung prüfen:** Liefert der Fronius-Smartmeter diese Felder? Am PC testen:
  `http://192.168.188.64/solar_api/v1/GetMeterRealtimeData.fcgi`
- **Vorteil:** exakte kumulierte Zählerstände. **Nachteil:** nur ab Reparatur-Zeitpunkt; Vergangenheit bleibt Näherung.

**Option B (einfacher): Energie im Collector aus `grid_power` integrieren.**
Pro Messung `power_io` über das Intervall aufsummieren und als kWh schreiben. Effektiv dasselbe wie die RPC-Näherung, nur an der Quelle. Wenig Mehrwert gegenüber 7a — daher Option A bevorzugen.

### Nach der Collector-Reparatur
RPC ggf. wieder auf echte `energy_in`/`energy_out` umstellen (oder belassen — die power_io-Näherung bleibt als Fallback robust).

---

## Energiedaten-Import (durchgeführt)

Aus altem Lovable-Projekt via CSV exportiert und importiert: `energy_readings` 23.–27.06. (~6150 Zeilen, davon ~5000 neu nach ON CONFLICT). Ergebnis: `energy_readings` reicht jetzt ab 23.06. statt 27.06.
- `rooms.csv` / `system_settings.csv` NICHT importiert (bereits vorhanden).
- Altes Lovable-Projekt hatte selbst nur Daten ab 23.06. — keine Monats-/Jahreshistorie verfügbar.
- 23.06. bleibt unvollständig (früheste Messung 22:13) → Score 0, wird belassen.

---

## compute-daily-score — Datums-Bug (Code-Fix committed, NICHT deployt)

`scoreOneDay()` verglich `r.date === dateStr` strikt. Die RPC liefert das Datum in abweichendem Format → `find()` = undefined → Tag wird übersprungen, nie geschrieben. Fix committed:
```js
const row = (weekly as any[]).find((r) => String(r.date).slice(0, 10) === dateStr);
```
⚠️ **Im Repo, aber NICHT deployt.** Solange nicht deployt, Scores per SQL pflegen (siehe Fix 7b). Nach Deploy: `body:{"backfill":7}` rechnet sauber nach.

---

## pg_cron-Stand nach dieser Sitzung (geänderte Jobs)

| Job | Schedule (UTC) | = Wien (Sommer) | Funktion             | Änderung |
|-----|----------------|-----------------|----------------------|----------|
| 10  | `0 5-21 * * *` | stündlich 7–23  | ai-parameter-advisor | von `*/15 5-21 * * *` |
| 15  | `30 4 * * *`   | 06:30           | ai-daily-planner     | von `0 5 * * *` |
| 16  | `0 4 * * *`    | 06:00           | fetch-pv-forecast    | von `0 6 * * *` |

---

## OFFENE PUNKTE / TODO

### Braucht Österreich-PC bzw. Deploy-Rechner
1. ⭐ **Collector-Fix (Weg 2 / Fix 7c):** `energy_in`/`energy_out` echt schreiben (Fronius-Smartmeter `GetMeterRealtimeData.fcgi`). Bis dahin liefert die RPC-Näherung (7a) brauchbare Werte.
2. **Deploy klären:** Wo/wie werden Edge Functions deployt? In Österreich liegt kein Repo. Deploy-Rechner mit Supabase CLI + `git clone` einrichten.
3. **Deploy ausstehender Code-Fixes:**
   - `ai-daily-planner` (Datums-Fix)
   - `compute-daily-score` (Datums-Fix)
   ```bash
   git pull
   supabase functions deploy ai-daily-planner
   supabase functions deploy compute-daily-score
   ```
4. **ANTHROPIC_API_KEY rotieren** (war im Klartext exponiert): revoke → neu → `supabase secrets set ANTHROPIC_API_KEY=...` (Wert nicht in Chats kopieren).

### Cloud-seitig / nächste Sitzung
5. **Gemini-Quota morgen prüfen** (frische Quota ~9–10 Uhr Wien): „Jetzt analysieren", dann `ai_parameter_decisions` auf neue Zeilen prüfen. Bei dauerhaftem 429 → bezahltes Google-AI-Tier erwägen.
6. **room_heating_logs:** Sobald sie zuverlässig mitlaufen (Lokalmodus aktiv), bekommt der Score die zweite Komponente (PV-Heizabdeckung) — Scores werden aussagekräftiger.
7. **Sommer-/Winterzeit** der UTC-Cron-Jobs: bei Bedarf auf zeitzonenbewusste Scheduler-Logik umstellen.
8. **23.06.** unvollständig — belassen, wächst aus dem Fenster.

---

## Verifikations-Checkliste für morgen früh (nach ~9–10 Uhr Wien)

```sql
-- 1) Tagesplan automatisch + korrektes Datum (Cron 6:30 Wien)?
select plan_date, source, created_at from ai_daily_plans order by created_at desc limit 1;

-- 2) PV-Prognose vorhanden (Cron 6:00 Wien)?
select date, expected_kwh, created_at from pv_forecasts order by date desc limit 3;

-- 3) Energiewerte echt (RPC-Fix)?
select date, round(pv_kwh,1) pv, round(energy_in_kwh,2) bezug, round(energy_out_kwh,1) einspeisung,
  round((pv_kwh-energy_out_kwh)/nullif(pv_kwh,0)*100,1) ev_prozent
from get_weekly_energy_summary(7) order by date desc;

-- 4) Scores differenziert?
select date, score, kpi_self_consumption_ratio from daily_pattern_scores order by date desc limit 8;

-- 5) Autopilot schreibt Decisions (nach "Jetzt analysieren")?
select created_at, parameter_key, decision_mode, proposed_value from ai_parameter_decisions order by created_at desc limit 10;
```

---

## Kernerkenntnisse dieser Sitzung

1. **Eine leere Tabelle (`heating_settings`) kann ein ganzes System lahmlegen** — sie hängt an dutzenden Funktionen. Nach Migration immer auf vollständige Seed-Daten prüfen.
2. **Der `energy_in/out=0`-Bug war die Wurzel fast aller Null-Anzeigen** — nicht ein Dutzend Einzelfehler, sondern eine Quelle mit Kaskade.
3. **pv_kwh war um Faktor 2 zu hoch** (60000- statt 120000-Teiler bei 30-s-Takt) — beim RPC-Fix mitbehoben.
4. **GitHub ≠ Live.** Code-Commits brauchen Deploy. DB-Änderungen wirken sofort — deshalb ließ sich das akute Problem komplett per SQL lösen.
5. **Niedrige Sommer-Scores sind korrekt**, nicht defekt. Der Wert der PV-Heizoptimierung zeigt sich im Winter; jetzt existiert das Messinstrument.
