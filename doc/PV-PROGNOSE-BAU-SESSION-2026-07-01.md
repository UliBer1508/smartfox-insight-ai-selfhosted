# PV-Prognose: Bau-Session (Frische-Fix + Lern-Fundament)

**Datum:** 1. Juli 2026 (Nachmittag-Session)
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** neue Tabelle `pv_forecast_accuracy`, neue Edge Function
`record-pv-accuracy`, pg_cron (neuer Job 23 + geänderter Job 16), Git-Setup

**Zusammenfassung:** Aufbauend auf der Analyse (`PV-PROGNOSE-LERNPROJEKT-ANALYSE-2026-07-01.md`)
wurden in dieser Session ZWEI komplementäre Verbesserungen der PV-Prognose gebaut und in Betrieb
genommen:
1. **Frische (wirkt sofort):** `fetch-pv-forecast` läuft jetzt 4x täglich statt 1x → die
   Heizlogik rechnet im Tagesverlauf mit der jeweils aktuellsten Prognose.
2. **Grundgenauigkeit (wirkt über Monate):** Retentionsfeste Erfassung von Prognose-vs-Ist
   (`pv_forecast_accuracy` + `record-pv-accuracy` + nächtlicher Cron) → Datenfundament, aus dem
   später der statische Saisonfaktor gelernt werden kann.
Außerdem: lokales Setup von ZIP-Download auf sauberen `git clone` umgestellt.

---

## Teil A — Frische-Fix: Mehrfach-Abruf der Tagesprognose  ✅ LIVE

### Problem (Ulis Beobachtung)
Die Heizlogik entscheidet morgens anhand der erwarteten Tages-kWh, ob sich Komfortheizen lohnt.
Diese Erwartung ist morgens am unsichersten (Regen angekündigt, tagsüber revidiert). Der
`fetch-pv-forecast`-Cron lief aber nur 1x um 6:00 Wien und fror den Wert für heute damit ein.

### Empirischer Test (Vorher-Nachher, statt Annahme)
`fetch-pv-forecast` manuell ausgelöst (Dashboard-Test-Button, Body `{}`, KEINE Header nötig —
Test-Button schickt Auth automatisch). Ergebnis für heute (01.07.):
- Morgens 6:00: `expected_kwh = 33.9`
- 10:57 (Testlauf): `expected_kwh = 37.1`, `fetched_at = 2026-07-01T10:57Z`
→ **Bewiesen:** Forecast.Solar liefert den laufenden Tag mit UND revidiert ihn (33.9 → 37.1).
Die Function upsertet per `onConflict: date`, überschreibt also den heutigen Wert korrekt.
Sie wurde nur zu selten aufgerufen.

### Fix (ein Cron-Eintrag, kein Code)
Bestehenden Job 16 (`fetch-pv-forecast-daily`) von 1x auf 4x/Tag erweitert:
```sql
select cron.alter_job(16, schedule := '0 4,7,10,13 * * *');
```
= 6:00 / 9:00 / 12:00 / 15:00 Wien (Sommer). Deckt den Zeitraum ab, in dem sich die Prognose
bewegt und Komfortheiz-Entscheidungen fallen. Sparsame Variante bewusst gewählt (vs. stündlich)
— 4 Läufe reichen für eine Heizsteuerung, schonen das Forecast.Solar-Limit.

**Sommer-/Winterzeit-Vorbehalt:** pg_cron rechnet UTC. Im Winter (UTC+1) läuft es 5/8/11/14 Wien.
Für eine Heizprognose unkritisch.

**Verifikation:** `select jobid, schedule from cron.job where jobid=16;` → `0 4,7,10,13 * * *` ✓

---

## Teil B — Lern-Fundament: retentionsfeste Prognose-vs-Ist-Erfassung  ✅ LIVE

### Warum (Kernproblem aus der Analyse)
`energy_readings.pv_power` wird nach 7 Tagen gelöscht (gleitendes Fenster, wächst nie an). Die
tatsächliche PV-Tagesproduktion wird nirgends dauerhaft gespeichert (`daily_patterns` hält nur
Netz-Import/-Export). Ein lernendes System löscht also seine eigene Lernbasis. Ohne dauerhafte
Prognose-vs-Ist-Paare kann der statische `getSeasonalFactor` nie durch einen gelernten ersetzt
werden. Entscheidung (Uli): **ab heute vorwärts sammeln** (Backfill nicht möglich — Altdaten
intern in Lovable, CSV-Export nur 5 Tage).

### Schritt 1 — Tabelle `pv_forecast_accuracy` (angelegt)
```sql
create table if not exists public.pv_forecast_accuracy (
  date            date primary key,
  forecast_kwh    numeric,          -- Prognose (expected_kwh aus pv_forecasts)
  actual_kwh      numeric,          -- tatsächlich produziert (Trapez über pv_power)
  abweichung_kwh  numeric,          -- actual - forecast
  ratio           numeric,          -- actual / forecast (Kern fürs Faktor-Lernen)
  saison_monat    int,              -- 1-12, Feature-Dimension
  sig_weather     text,             -- sunny/mixed/cloudy
  sig_pv_bucket   text,             -- low/mid/high
  samples         int,              -- Anzahl pv_power-Messpunkte (Datenqualität)
  created_at      timestamptz default now()
);
```
Retentionsfest, ~365 Zeilen/Jahr. Feature-Spalten bewusst für späteres ML angelegt.

### Schritt 2 — Edge Function `record-pv-accuracy` (deployt)
Datei: `supabase/functions/record-pv-accuracy/index.ts`. Ablauf:
1. Ziel-Tag = heute (Wien, `en-CA`-Muster, KEIN Doppelcast).
2. `pv_power`-Samples des Tages aus `energy_readings` laden — **`.limit(5000)`** (WICHTIG:
   Supabase-Default ist 1000 → an vollen Tagen sonst abgeschnitten, `actual_kwh` zu niedrig,
   `ratio` verzerrt). Beim ersten Test fiel `samples: 1000` auf → Fix eingebaut.
3. Ist-kWh per Trapez integrieren (Logik aus pv-automation: Lücken >10min überspringen,
   `(w1+w2)/2 * dtHours`).
4. Prognose aus `pv_forecasts` holen (`expected_kwh`).
5. Wetter-/PV-Bucket bestimmen (identisch zu compute-daily-score: `bucketWeather`/`bucketPv`).
6. Upsert nach `pv_forecast_accuracy` (`onConflict: date`, idempotent).
Auth-Muster + Buckets aus `compute-daily-score` übernommen (Konsistenz).

**Erster Testlauf (12:41 Wien) erfolgreich:**
```json
{ "ok": true, "date": "2026-07-01", "forecast_kwh": 33.9,
  "actual_kwh": 3.67, "ratio": 0.108, "samples": 1000 }
```
Zeile in Tabelle bestätigt. Niedriger ratio korrekt (Tag erst zu ~1/8 gelaufen). `samples:1000`
war der Auslöser für den Limit-Fix (danach neu deployt).

### Schritt 3 — Cron-Job (Job 23, angelegt)
```sql
select cron.schedule(
  'record-pv-accuracy-daily',
  '30 21 * * *',   -- 21:30 UTC = 23:30 Wien (Sommer); Winter 22:30 Wien
  $$ select net.http_post(
       url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/record-pv-accuracy',
       headers := jsonb_build_object('Content-Type','application/json',
         'apikey','<ANON_KEY>','Authorization','Bearer <ANON_KEY>'),
       body := '{}'::jsonb); $$
);
```
23:30 Wien: Tag komplett, aber Rohdaten (7-Tage-Retention) noch nicht gelöscht. **Fester
anon_key** im Command (NICHT `current_setting` → sonst 401, siehe Fix 30.06.).
**Verifikation:** Job 23 aktiv, schedule `30 21 * * *` ✓.

---

## Teil C — Git-Setup saniert (ZIP-Download → git clone)  ✅

### Problem
Lokaler Ordner war ZIP-Download (`...-main`), kein Repo → „drei Kopien / welche gilt"-Chaos
(Quelle vieler Verwechslungen der letzten Tage). Git installiert, aber nicht im PATH.

### Durchgeführt
- Git in PATH (nur Session): `$env:Path += ";C:\Program Files\Git\cmd"` (dauerhaft noch offen).
- `git clone https://github.com/UliBer1508/smartfox-insight-ai-selfhosted.git repo` nach
  `C:\Heizung\repo`.
- **Windows-Stolperstein:** Checkout scheiterte an Datei `doc/Fix-Dokumentation: ...` (Doppelpunkt
  im Namen — auf Windows ungültig). Lokal ruhiggestellt via
  `git update-index --assume-unchanged` + Geister-Datei gelöscht. Datei bleibt auf GitHub.
  → TODO: Doku-Dateien mit Doppelpunkt auf GitHub umbenennen (Windows-Kompatibilität).
- `supabase link --project-ref pflnniklvqbwjwrjswaz` → Deploy aus neuem Ordner möglich.
- Erster voller Zyklus inkl. Merge geübt: `git pull --no-rebase` (vim-Merge-Message mit `:wq`),
  `git push`. Neuer Standard-Workflow etabliert:
  `git pull` → ändern → `git add -A` → `git commit -m "..."` → `git push` → `supabase functions deploy NAME`.

### Offene Repo-Hygiene
- `supabase/.temp/`-Dateien wurden mehrfach versehentlich committet → gehören in `.gitignore`
  (lokale CLI-Metadaten, keine Secrets). **Noch nicht bereinigt.**
- Git dauerhaft in den PATH setzen (aktuell nur pro Session).
- Optional: Git-Editor von vim auf Notepad/VS Code umstellen (`git config --global core.editor`).

---

## Architektur-Einordnung (warum zwei getrennte Ebenen)

Die PV-Prognose wurde bewusst auf zwei komplementären Ebenen verbessert:
- **Frische (Teil A):** kurzfristig die Aktualität erhöhen — der handgeschätzte Saisonfaktor
  bleibt, aber die Rohprognose wird mehrfach täglich nachgeführt. Wirkt SOFORT.
- **Grundgenauigkeit (Teil B):** langfristig die Basis lernen — aus Prognose-vs-Ist-Paaren wird
  über Monate ein anlagenspezifischer Faktor gelernt, der `getSeasonalFactor` ersetzt. Wirkt
  über MONATE.
Regelbasiert + lernend ergänzen sich: Heuristik läuft weiter, bis das Gelernte gut genug ist,
sie zu ersetzen. Zusätzlich existiert die Intraday-`forecastAccuracy` in pv-automation (korrigiert
die Restprognose live gegen die tatsächliche Produktion seit Sonnenaufgang) — deckt den laufenden
Tag ab, startet aber morgens bei null Wissen.

---

## Kontrollblick morgen früh
```sql
-- 1) Nachtlauf von record-pv-accuracy erfolgreich? Voller Tageswert?
select date, forecast_kwh, actual_kwh, ratio, samples
from pv_forecast_accuracy order by date desc limit 3;
-- Erwartung: 01.07. mit VOLLER Produktion (~60-78 kWh bei Sonne, NICHT mehr 3.67),
--            samples deutlich >1000 (Limit-Fix wirkt an vollen Tagen).

-- 2) Mehrfach-Abruf der Prognose greift? (fetched_at über den Tag mehrfach frisch)
select date, expected_kwh, fetched_at from pv_forecasts order by date desc limit 3;
-- Erwartung: heutiger Eintrag mit fetched_at nach 6:00/9:00/12:00/15:00 aktualisiert.
```

---

## Nächste Ausbaustufe (SPÄTER, wenn Datenreihe lang genug)
Das eigentliche Lernstück: `getSeasonalFactor` durch einen aus `pv_forecast_accuracy` gelernten
Faktor ersetzen. Pro Monat/Wettersignatur den mittleren `ratio` bilden, Confidence aus
Stichprobenzahl (Vorbild `analyze-solar-gain`). Solange Confidence niedrig → statischer Faktor
als Fallback. Braucht Wochen/Monate Daten — v.a. Herbst/Winter, wo die Abweichung am größten ist.

## Status / Offen
**Erledigt & live:** Teil A (Frische), Teil B (Erfassung), Teil C (git clone).
**Offen (Repo-Hygiene):** `.temp` in `.gitignore`, Git dauerhaft in PATH, Doppelpunkt-Doku
umbenennen, ggf. Git-Editor umstellen.
**Offen (unverändert):** ANTHROPIC_API_KEY rotieren; Österreich (Collector umbiegen, NSSM);
später Lovable löschen.
