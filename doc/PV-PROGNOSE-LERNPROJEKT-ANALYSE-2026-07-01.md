# PV-Prognose-Lernprojekt: Analyse & Bauplan

**Datum:** 1. Juli 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Status:** Analyse abgeschlossen, Bau noch nicht begonnen (bewusster Schnitt für frischen Kopf)

**Zusammenfassung:** Untersuchung, ob und wie die PV-Tagesprognose (`fetch-pv-forecast`)
verbessert werden kann. Ergebnis: Der statische saisonale Korrekturfaktor ist der einzige
nicht-lernende Fremdkörper in einem sonst lernenden System. Ein Ersetzen durch einen aus
echten Daten gelernten Faktor lohnt sich — scheitert aber aktuell an fehlender Datenbasis,
weil die Retention die "Wahrheit" (tatsächliche PV-Produktion) löscht, bevor genug
zusammenkommt. Nächster Schritt: retentionsfeste Erfassung ab heute vorwärts.

---

## Auslöser (Uli's Beobachtung)

Zwei Punkte aus der Praxis:
1. **Prognose-Frische:** Wetterprognosen sind morgens vage (Regen angekündigt, im Tagesverlauf
   mehrfach revidiert). Eine PV-Prognose von *gestern* für *heute* kann nicht aktuell sein.
2. **Prognose vs. Realität:** Es gibt historische Werte (prognostiziert vs. tatsächlich
   produzierter PV-Strom), aus denen man lernen könnte, ob und wie stark die Prognose abweicht.

Beide Punkte sind fachlich berechtigt.

---

## Befund 1 — Das System korrigiert bereits INTRADAY (gut gebaut)

In `pv-automation/index.ts` (Zeile ~1320–1350) existiert `forecastAccuracy`:
- Nimmt die **prognostizierten** Wh seit Sonnenaufgang bis zur aktuellen Stunde.
- Teilt durch die **tatsächlich produzierten** Wh (Trapez-Integration über `pv_power`).
- Verhältnis < 1 → weniger Sonne als vorhergesagt → restliche Tagesprognose wird nach unten
  korrigiert (`remainingPvForecastWh * forecastAccuracy`).

Das ist solide: Trapez gegen Datenlücken, konservative 0.7-Annahme bei <3 Samples am frühen
Morgen, Deckelung bei 2.0. Das System merkt also *innerhalb des Tages*, wenn die Vorhersage
danebenliegt — genau die geforderte Frische ist an dieser Stelle schon da.

**Aber:** Diese Korrektur startet jeden Morgen bei null Wissen. Basis ist die rohe
Forecast.Solar-Prognose plus der statische `getSeasonalFactor`. Am frühen Morgen — wenn die
wichtigsten Heizentscheidungen fallen — gibt es noch keine Datenbasis (konservativ 0.7).

---

## Befund 2 — Der statische Saisonfaktor ist der Schwachpunkt

In `fetch-pv-forecast/index.ts`, Funktion `getSeasonalFactor(month)`:
```js
const factors = {
  1: 0.35, 2: 0.45, 3: 0.65, 4: 0.80, 5: 0.90, 6: 1.00,
  7: 1.00, 8: 0.95, 9: 0.80, 10: 0.60, 11: 0.40, 12: 0.30,
};
```
Das sind **handgeschätzte Monatswerte**, identisch für jede Anlage weltweit. Ulis konkrete
Anlage (15.8 kWp, ~47°N in den Bergen, spezifische Verschattung/Ausrichtung/Alterung) wird
über denselben Kamm geschoren wie eine Flachlandanlage. Forecast.Solar liefert Idealwerte,
dieser Faktor ist die einzige (grobe) Korrektur.

**Das ist der einzige nicht-lernende Fremdkörper im Solar-Pfad.**

---

## Befund 3 — Das System kann anderswo BEREITS lernen (Vorlage vorhanden)

`analyze-solar-gain/index.ts` ist ein sauberes Lernverfahren:
- Misst pro Raum aus echten `room_temperature_samples`, wie stark die Sonne wärmt und wie
  schnell Wärme verloren geht (Heizung AUS + PV-Leistung als Signal).
- Berechnet `calculated_solar_gain_factor`, `calculated_heat_loss_rate` und eine **Confidence**
  aus Varianz + Stichprobenzahl.
- Schreibt lernend in die `rooms`-Tabelle zurück.

→ Das Prinzip "aus Realität lernen statt Konstanten raten" ist im System schon umgesetzt.
Die PV-Prognose ist die eine Stelle, wo es fehlt. **`analyze-solar-gain` ist die Bauvorlage**
für die Confidence-/Stichprobenlogik des PV-Lernmodells.

---

## Befund 4 — Die tatsächliche PV-Produktion wird NICHT dauerhaft gespeichert (Kernproblem)

Datenfluss der Retention (`aggregate-energy-data/index.ts`):
- Rohdaten `energy_readings` (inkl. `pv_power` als Momentanleistung W) → **7 Tage** aufbewahrt.
- Danach verdichtet zu `hourly_aggregates` → **90 Tage**.
- Danach zu `daily_patterns`.

**Aber:** In `daily_patterns` landen `total_energy_in/out`, `net_energy` — also
**Netz-Import/-Export**, NICHT die PV-Produktion. Die tatsächlich produzierten kWh pro Tag
werden nirgends dauerhaft als Tageswert gespeichert. Das feingranulare `pv_power` ist nach
7 Tagen weg.

**Konsequenz:** Ein lernendes System löscht systematisch genau die Daten, aus denen es lernen
müsste. Prognose-vs-Ist-Paare über mehrere Monate — die Basis für einen gelernten Saisonfaktor
— existieren nirgends abrufbar.

---

## Datenlage-Prüfung (heute durchgeführt)

**Live-DB (neues Projekt):**
```sql
select min(timestamp)::date, max(timestamp)::date, count(*),
       count(*) filter (where pv_power>0)
from energy_readings;
-- Ergebnis: 2026-06-23 bis 2026-07-01, 16244 Zeilen, pv_power fast durchg/gefüllt
```
→ Nur ~8 Tage, weil Retention = 7 Tage (gleitendes Fenster, wächst NICHT weiter an).

**CSV-Export `energy_readings.csv`** (aus Google Drive, "1 day ago"):
- Nur 5 Tage (23.–27.06.2026), 6153 Zeilen. Spalten: id, timestamp, power_io, energy_in,
  energy_out, created_at, battery_soc, **pv_power**, consumption, battery_power.
- Also KEIN Saison-Export, sondern frischer Auszug ~gleicher Zeitraum.

**Tatsächliche PV-Tagesproduktion (Trapez-Integration, aus CSV berechnet):**
| Tag        | Ist_kWh | Peak_kW |
|------------|---------|---------|
| 2026-06-23 | 62.7    | 10.4    |
| 2026-06-24 | 61.3    | 10.4    |
| 2026-06-25 | 76.8    | 10.2    |
| 2026-06-26 | 77.5    | 9.8     |
| 2026-06-27 | 27.1 (Tag abgeschnitten, nur 573 Samples) |

Zum Vergleich bekannte Prognosewerte (`pv_forecasts.expected_kwh`): 33.9 / 45.9 / 74 kWh.
→ Starke Streuung, Prognose teils deutlich unter realer Produktion. **Indiz** für Ulis
Beobachtung, aber 4 Tage sind KEINE belastbare Basis (Zufall vs. systematischer Fehler nicht
unterscheidbar).

**`system_settings.csv`:** Enthält aggregierte KPI-Summaries (Mai-Tagesreihe im
`analysis_summary_month`, Wettersignaturen im `monthly_playbook` mit `total_pv_kwh`). Das ist
Ist-Historie, aber OHNE die damalige Prognose daneben → für Prognose-vs-Ist-Vergleich
unbrauchbar. Bestätigt: saubere Paar-Historie existiert nirgends.

**Alte Lovable-DB:** intern, kein SQL-Zugriff. Historie darüber nicht abrufbar.

---

## Entscheidung: "ab heute vorwärts sammeln"

Für ein SAISON-Modell braucht man Daten über Monate (Winter/Herbst, wo die Abweichung am
größten ist). Die fehlen und sind nicht beschaffbar. Daher bewusste Entscheidung (Uli):
**vorwärts sammeln** statt Backfill mit lückenhaften Altdaten. Sauber, aber langsam — die
lange Reihe zählt, nicht die ersten Tage.

---

## BAUPLAN (nächste Session) — erster Baustein: retentionsfeste Erfassung

### Schritt 1: Neue Tabelle `pv_forecast_accuracy` (retentionsfest, winzig, ~365 Zeilen/Jahr)
Entwurf (Feinschliff beim Bau):
```sql
create table if not exists public.pv_forecast_accuracy (
  date            date primary key,
  forecast_kwh    numeric,          -- expected_kwh aus pv_forecasts (heutige Prognose für den Tag)
  actual_kwh      numeric,          -- Trapez-Integration über pv_power dieses Tages
  abweichung_kwh  numeric,          -- actual - forecast
  ratio           numeric,          -- actual / forecast (für Faktor-Lernen)
  saison_monat    int,              -- 1-12 (Feature-Dimension)
  sig_weather     text,             -- sunny/mixed/cloudy (aus vorhandener Signatur-Logik)
  sig_pv_bucket   text,             -- low/mid/high
  samples         int,              -- Anzahl pv_power-Messpunkte (Datenqualität)
  created_at      timestamptz default now()
);
```
→ Wird NICHT von der Retention angefasst. Feature-Spalten (Monat, Wetter) bewusst für spätere
Modellierung angelegt.

### Schritt 2: Sammel-Job (neue Edge Function, z.B. `record-pv-accuracy`)
Ablauf, einmal täglich SPÄT (Tag komplett, aber Rohdaten noch nicht gelöscht — z.B. 23:30 Wien):
1. Ziel-Tag = heute (Wien-Zeit, `en-CA`-Muster wie im Rest des Codes — NICHT toISOString/Doppelcast).
2. `pv_power`-Samples des Tages aus `energy_readings` laden (ab 00:00 bis jetzt).
3. Ist-kWh per Trapez integrieren (Logik aus `pv-automation` Zeile ~1336–1348 übernehmen:
   Lücken >10min überspringen, `(w1+w2)/2 * dtHours`).
4. Prognose aus `pv_forecasts` für diesen Tag holen (`expected_kwh`).
5. Wettersignatur bestimmen (Logik aus `compute-daily-score` `bucketWeather`/`bucketPv` wiederverwenden).
6. Eine Zeile in `pv_forecast_accuracy` upserten (`onConflict: date`).

### Schritt 3: Cron-Job (pg_cron)
Täglich 23:30 Wien = 21:30 UTC (Sommer). **Achtung Sommer-/Winterzeit** (pg_cron rechnet UTC,
kennt keine DST — siehe Doku 30.06.). Fester anon_key im Command (NICHT `current_setting`,
sonst 401 — siehe Fix 30.06.).

### Schritt 4 (SPÄTER, wenn genug Daten): Das eigentliche Lernstück
Nach mehreren Wochen/Monaten: `getSeasonalFactor` durch einen aus `pv_forecast_accuracy`
gelernten Faktor ersetzen. Pro Monat (oder pro Wettersignatur) den mittleren `ratio` bilden,
mit Confidence aus Stichprobenzahl (Vorbild `analyze-solar-gain`). Solange Confidence niedrig →
statischen Faktor als Fallback behalten. Das ist der Übergang von "Experte schreibt Regel hin"
zu "System lernt Regel aus Beobachtung".

---

## Nebenbefund: Prognose-Frische verbessern (unabhängig, billig)
`fetch-pv-forecast` upsertet bereits alle von Forecast.Solar gelieferten Tage (heute + morgen)
per `onConflict: date` — kann also den heutigen Wert aktualisieren. Um die von Uli gewünschte
Tagesverlaufs-Verdichtung zu bekommen: Cron NICHT nur 6:00 Wien, sondern zusätzlich z.B. 10:00
und 13:00 laufen lassen. Ein Cron-Eintrag, kein Code-Umbau. (Vorher prüfen, ob Forecast.Solar
den laufenden Tag vormittags noch mitliefert — per Testlauf: aktualisiert sich `fetched_at`
des heutigen Eintrags?)

---

## Offene Repo-Hygiene (heute nebenbei aufgetaucht)
- `supabase/.temp/`-Dateien wurden versehentlich committet (linked-project.json etc.) →
  gehören in `.gitignore`, sind lokale Maschinen-Dateien.
- Doku-Dateien mit Doppelpunkt im Namen (`doc/Fix-Dokumentation: ...`) brechen `git clone`
  auf Windows (invalid path). Bei Gelegenheit auf GitHub umbenennen (Doppelpunkt raus).
  Lokal per `git update-index --assume-unchanged` ruhiggestellt.

---

## Setup-Fortschritt heute (wichtig!)
- Lokaler Ordner war ZIP-Download (kein git). JETZT: sauberer `git clone` nach `C:\Heizung\repo`,
  mit `supabase link --project-ref pflnniklvqbwjwrjswaz` gebunden. Git ist im PATH (nur für die
  Session — dauerhaft noch setzen). Neuer Workflow etabliert:
  `git pull` → ändern → `git add -A` → `git commit -m "..."` → `git push` → `supabase functions deploy NAME`.
- Damit ist die "drei Kopien / welche gilt"-Falle strukturell beseitigt.
