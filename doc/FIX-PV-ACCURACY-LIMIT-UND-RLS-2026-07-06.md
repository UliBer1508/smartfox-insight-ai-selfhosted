# Fix-Dokumentation: PV-Prognose-Karte blieb leer (zwei Bugs)

**Datum:** 6. Juli 2026 (Vormittag-Session, aus Munich)
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted` (privat)
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffene Komponenten:** Edge Function `record-pv-accuracy`, Tabelle `pv_forecast_accuracy`, Hook `usePvAccuracy.ts`, Karte `PvAccuracyChart.tsx`

**Zusammenfassung:** Die Dashboard-Karte „PV-Prognose vs. Realität" zeigte auch nach
mehreren Tagen weiter „Noch keine Genauigkeitsdaten vorhanden". Ursache waren ZWEI
unabhängige Bugs, die sich gegenseitig verdeckt haben: (1) `record-pv-accuracy`
integrierte wegen eines wirkungslosen `.limit(5000)` nur die ersten 1000 Messwerte des
Tages → viel zu kleine `actual_kwh`; (2) die Tabelle `pv_forecast_accuracy` hatte RLS
aktiv, aber KEINE Policy → das Dashboard (anon/authenticated) durfte die Zeilen gar nicht
lesen, obwohl sie in der DB standen. Beide behoben, Karte zeigt jetzt die Kurve.

---

## Bug 1 — actual_kwh viel zu klein (`.limit(5000)` wirkungslos)  ✅ GELÖST

### Symptom
- `pv_forecast_accuracy` enthielt Zeilen für 03./04./05.07., aber mit absurd kleinen
  Ist-Werten: 0.68 / 3.13 / 4.36 kWh gegen Prognosen von 57 / 74 / 42 kWh.
- Alle Zeilen hatten exakt `samples = 1000`.

### Kernerkenntnis
Das exakte `samples = 1000` war der Fingerabdruck der Supabase-1000-Zeilen-Grenze.
Der Code hatte zwar `.limit(5000)` mit korrektem Kommentar, aber **PostgREST kappt hart
auf das Server-`max-rows`-Limit (1000)** — der clientseitige `.limit()` wird still
überschrieben. Bei ~2900 Messwerten pro Tag (alle 30 s) wurden dadurch nur die ersten
~8 Stunden ab Mitternacht integriert (1000 × 0.5 min ≈ 500 min ≈ 08:20 Uhr) —
also im Wesentlichen die Nacht plus früher Vormittag. Der ertragreiche Mittag fehlte.

### Diagnose-Weg (zur Wiederverwendung)
```sql
-- Zeitliche Dichte + Lücken der pv_power-Messwerte eines vollen Tages prüfen
with s as (
  select timestamp,
         extract(epoch from (timestamp - lag(timestamp) over (order by timestamp)))/60 as gap_min
  from energy_readings
  where timestamp >= '2026-07-04T00:00:00+02:00'
    and timestamp <= '2026-07-04T23:59:59+02:00'
    and pv_power is not null
)
select count(*), round(avg(gap_min)::numeric,2), round(max(gap_min)::numeric,2),
       count(*) filter (where gap_min > 10) as luecken_ueber_10min
from s;
-- Ergebnis: 2868 Messwerte, Schnitt 0.5 min, max 6 min, 0 Lücken über 10 min
-- -> der 10-Minuten-Lückenfilter war UNSCHULDIG; das Limit war der Killer.
```

### Fix
`.select().limit(5000)` durch eine Paginierungs-Funktion ersetzt, die in 1000er-Blöcken
per `.range(from, to)` lädt, bis der Tag vollständig ist:

```ts
async function fetchAllReadings(dayStart, dayEnd) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('energy_readings')
      .select('timestamp, pv_power')
      .gte('timestamp', dayStart).lte('timestamp', dayEnd)
      .order('timestamp', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows: all, error: error.message };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;   // letzte Teilseite
    if (from > 100_000) break;       // Sicherheitsgrenze
  }
  return { rows: all, error: null };
}
```

### Verifikation
Deploy (`supabase functions deploy record-pv-accuracy`, Projekt `pflnniklvqbwjwrjswaz`),
dann die drei Tage per Dashboard-Test (`{"date":"..."}`) neu berechnet:

| date | forecast_kwh | actual_kwh (vorher → nachher) | ratio | samples |
|---|---|---|---|---|
| 05.07. | 42.1 | 4.36 → **41.74** | 0.991 | 2879 |
| 04.07. | 74.3 | 3.13 → **73.45** | 0.989 | 2868 |
| 03.07. | 57.1 | 0.68 → **33.18** | 0.581 | 2879 |

05./04. fast perfekt; 03. echter bewölkter Minderertrag (samples voll → echter
Prognosefehler, kein Messfehler mehr). Genau die Daten, die das System zum Lernen braucht.

---

## Bug 2 — RLS aktiv, aber keine Policy → Dashboard sah nichts  ✅ GELÖST

### Symptom
Nach Bug-1-Fix standen drei korrekte Zeilen in `pv_forecast_accuracy`, aber die Karte
blieb leer — auch nach hartem Reload (Strg+Shift+R). Kein Cache-Problem.

### Kernerkenntnis (WICHTIG — siehe Warnung unten)
`pv_forecast_accuracy` hatte **RLS aktiviert, aber KEINE einzige Policy**. Bei aktivem
RLS ohne Policy gilt: **niemand darf lesen außer der Service-Role.** Deshalb sah der
SQL-Editor (Service-Role, umgeht RLS) die Daten, das Dashboard (anon/authenticated-Key)
aber nicht — es bekam ein leeres `[]` zurück, ohne Fehler. Der Hook `usePvAccuracy`
meldete daraufhin `rowCount = 0`, und `PvAccuracyChart` zeigte den Leer-Zustand.

Warum fiel das erst jetzt auf: Die Karte war wegen Bug 1 ohnehin nie sinnvoll gefüllt.
Zwei Bugs hintereinander, die sich gegenseitig verdeckt haben.

### Diagnose-Weg (zur Wiederverwendung)
```sql
-- 1) Ist RLS an?
select relname, relrowsecurity from pg_class where relname = 'pv_forecast_accuracy';
-- true  -> RLS aktiv

-- 2) Welche Policies gibt es?
select policyname, cmd, roles, qual from pg_policies
where tablename = 'pv_forecast_accuracy';
-- "no rows returned"  <- URSACHE: RLS an, aber gar keine Policy

-- 3) Gegencheck an funktionierender Tabelle (pv_forecasts zeigt Daten an)
select policyname, cmd, roles, qual from pg_policies where tablename = 'pv_forecasts';
-- -> "Authenticated users full access" | ALL | {authenticated} | auth.uid() IS NOT NULL
```

### Fix
Die Policy der funktionierenden Tabelle 1:1 übernommen:
```sql
create policy "Authenticated users full access"
on pv_forecast_accuracy
for all
to authenticated
using (auth.uid() IS NOT NULL)
with check (auth.uid() IS NOT NULL);
```
(In dieser Session wurde zusätzlich eine reine SELECT-Policy für {anon,authenticated}
angelegt — funktional redundant, schadet aber nicht. Kann später auf eine reduziert
werden.)

### Verifikation
Dashboard neu geladen (F5) → Karte zeigt drei Datenpunkte: gelbe Ist-Linie,
blau gestrichelte Prognose-Linie, Verhältnis-Balken. Fußzeile „3 Tage erfasst,
Ø Ist/Prognose: 0.85".

---

## ⚠️ GRUNDSATZ-WARNUNG: Zugriffsrechte (RLS) IMMER von Anfang an prüfen

**Das eigentliche Grundproblem dieser Session war, dass wir die Zugriffsrechte (RLS)
nicht von Anfang an berücksichtigt haben.** Diese Falle kostet garantiert Zeit, weil sie
sich tückisch verhält:

- Eine Tabelle mit **RLS aktiv, aber ohne passende Policy** sieht im SQL-Editor völlig
  normal aus (Service-Role umgeht RLS), ist für die App (anon/authenticated) aber
  **komplett unsichtbar** — ohne jede Fehlermeldung, nur leere Ergebnisse.
- Supabase aktiviert RLS bei neu angelegten Tabellen oft per Default. Die begleitende
  Policy wird leicht vergessen.

**Feste Regel ab jetzt — bei JEDER neuen Tabelle, die das Frontend lesen/schreiben soll:**

1. Direkt nach dem Anlegen prüfen:
   ```sql
   select relname, relrowsecurity from pg_class where relname = 'TABELLENNAME';
   select policyname, cmd, roles, qual from pg_policies where tablename = 'TABELLENNAME';
   ```
2. Ist RLS an und es fehlt eine passende Policy → sofort die Standard-Policy setzen
   (gleiches Muster wie die funktionierenden Tabellen, z. B. `pv_forecasts`,
   `heating_settings`):
   ```sql
   create policy "Authenticated users full access"
   on TABELLENNAME for all to authenticated
   using (auth.uid() IS NOT NULL) with check (auth.uid() IS NOT NULL);
   ```
3. Faustregel zur schnellen Diagnose: **„SQL-Editor sieht Daten, App sieht nichts"
   = fast immer RLS ohne Policy.**

**Empfohlener Nachtrag beim nächsten Österreich-Besuch:** Alle im Zuge der Selbst-Hosting-
Migration neu angelegten Tabellen einmal auf dieses Muster durchsehen — es kann weitere
Tabellen geben, bei denen RLS aktiv ist, aber die Policy fehlt, und die nur deshalb noch
nicht aufgefallen sind, weil die zugehörige UI (wie hier) ohnehin leer war.

---

## LEHREN (Ergänzung zu den bestehenden Regeln)

1. **PostgREST kappt hart auf `max-rows` (meist 1000)** — clientseitiges `.limit(5000)`
   allein reicht NICHT. Für Abfragen, die über 1000 Zeilen gehen können,
   `.range()`-Paginierung in Blöcken verwenden. (Ergänzt die bestehende
   1000-Zeilen-Regel um den entscheidenden Punkt: das Limit greift auch trotz `.limit()`.)
2. **`samples = exakt 1000`** (oder jede aggregierte Zahl, die genau auf 1000 landet)
   ist ein Warnsignal für eine still gekappte Query — nicht als Zufall abtun.
3. **RLS ohne Policy = für die App unsichtbar.** Bei „SQL-Editor sieht Daten, Dashboard
   leer" zuerst RLS/Policies prüfen, bevor man Hook- oder Chart-Code verdächtigt.
   → siehe Grundsatz-Warnung oben.
4. **Bei leeren Karten Diagnose von hinten aufrollen:** erst DB (stehen Daten drin?),
   dann Zugriffsrecht (darf die App lesen?), dann Hook/Query, zuletzt die Chart-Komponente.
   Hier lag der Fehler in den ersten beiden Stufen — die Chart-Komponente war korrekt.

---

## Ablauf-Stolpersteine dieser Session (für nächstes Mal)

- **`git` fehlte im PATH** auf dem Munich-PC → per `winget install --id Git.Git -e`
  installiert, danach **PowerShell-Fenster neu starten** (sonst PATH nicht geladen).
- **CLI war mit dem falschen Projekt verbunden** (`usblrulkcgucxtkhugck` = Ferienhaus),
  weil aus `C:\Windows\system32` heraus deployt wurde. Erst `cd C:\Heizung\repo`, dann
  `supabase link --project-ref pflnniklvqbwjwrjswaz`, dann deployen. Immer aus dem Repo
  heraus arbeiten, damit die `config.toml` das richtige Projekt wählt.
- **`git push` abgelehnt** (Remote hatte neuere Commits) → `git pull --no-rebase`
  (Merge-Editor mit `:wq` + Enter bestätigen), dann `git push`.
- **Docker-Warnung beim Deploy ist harmlos** — Function-Deploys brauchen kein Docker.

---

## Status nach dieser Session

| Punkt | Status |
|---|---|
| `record-pv-accuracy` paginiert alle Samples | ✅ deployt (`pflnniklvqbwjwrjswaz`) |
| 03./04./05.07. neu berechnet, korrekte actual_kwh | ✅ |
| RLS-Policy auf `pv_forecast_accuracy` | ✅ gesetzt |
| Karte „PV-Prognose vs. Realität" zeigt Kurve | ✅ live |
| Fix committet, gemerged, gepusht | ✅ (`b98f37b..ac5e54a`) |
| Nächster Auto-Lauf (Job 23, 23:30 Wien) schreibt 06.07. | ⏳ heute Nacht |
| Redundante zweite RLS-Policy entfernen | 🔲 optional, Kosmetik |
| Andere neue Tabellen auf RLS-ohne-Policy prüfen | 🔲 beim nächsten Österreich-Besuch |
