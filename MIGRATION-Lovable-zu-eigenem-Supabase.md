# Migration: smartfox-insight-ai von Lovable Cloud auf eigenes Supabase

**Ziel:** Den kompletten Lovable-Teil (App + 23 Edge Functions + Schema + Daten) aus Lovable Cloud (Projekt-Ref `tvqmhdpcixkfsudxughs`) auf ein eigenes Supabase-Projekt in der eigenen Organisation (`uliberresheim-hotmailde`) umziehen.

**Grund:** Unabhängigkeit von Lovable Cloud, eigene Kostenkontrolle.

**Prinzip:** Kopie zuerst, parallel testen, erst danach umschalten und Lovable rausnehmen. Das Live-System läuft während der gesamten Etappe 1 unverändert weiter.

**Wichtig:** Vor Ort am miniPC durchführen (Collector-Umstellung beim finalen Umschalten nötig).

---

## Was bereits zu deinen Gunsten vorliegt

- Gesamter Code liegt auf GitHub (`UliBer1508/smartfox-insight-ai`).
- Schema ist lückenlos als Migrations versioniert (`supabase/migrations/`, 100+ SQL-Dateien).
- Alle 23 Edge Functions liegen im Code (`supabase/functions/`).
- Functions-Konfiguration (`verify_jwt = false`) steht in `supabase/config.toml`.

## Was NICHT automatisch mitkommt (die eigentliche Arbeit)

- **Secrets** der Edge Functions (Tuya, Gemini/AI-Key, Wetter-/Preis-APIs) – stehen aus Sicherheitsgründen nicht im Code.
- **Daten** der Tabellen (z.B. `energy_readings` ~10.000 Zeilen, `api_errors` ~90.000 Zeilen).
- **Collector-Verbindung** – zeigt nach dem Umzug noch auf die alte DB, muss umgestellt werden.

---

## Voraussetzungen (einmalig auf dem miniPC)

- [ ] Node.js installiert (`node --version`, v18+)
- [ ] Supabase CLI installiert: `npm install -g supabase`
- [ ] Git installiert
- [ ] Zugang zum eigenen Supabase-Account (Org `uliberresheim-hotmailde`)

---

# ETAPPE 0 — Sicherung (zuerst, nicht verhandelbar)

- [ ] **Backup der Lovable-Cloud-DB.** In Lovable: Cloud → Database → "Backups" (oben rechts). Vollständigen Snapshot ziehen/herunterladen.
- [ ] **Secrets-Liste erstellen.** In Lovable: Cloud → Secrets. Alle Namen notieren (Werte falls einsehbar mitnotieren, sonst aus den Originalquellen neu beschaffen: Tuya-Zugang, AI-API-Key, Wetter-/Strompreis-API-Keys).
- [ ] **Aktuelle Collector-config.json sichern** (alte `supabase_url` + `supabase_key` notieren, für Rückfall).
- [ ] **Liste der Cron-Jobs/Scheduler notieren.** Prüfen, ob `analysis-scheduler` per pg_cron/Scheduler läuft – diese Zeitpläne wandern NICHT über Migrations mit und müssen im neuen Projekt neu eingerichtet werden.

---

# ETAPPE 1 — Kopie aufbauen und PARALLEL testen (kein Risiko fürs Live-System)

## 1.1 Entkoppelte Repo-Kopie erstellen

```
cd C:\Projekte
git clone https://github.com/UliBer1508/smartfox-insight-ai.git smartfox-eigen
cd smartfox-eigen
git remote remove origin
rmdir /s /q .lovable
```

Neues PRIVATES Repo auf github.com anlegen (z.B. `smartfox-eigen`), dann:

```
git remote add origin https://github.com/UliBer1508/smartfox-eigen.git
git branch -M main
git add -A
git commit -m "Entkoppelte Kopie: Lovable-Anbindung entfernt"
git push -u origin main
```

## 1.2 Neues Supabase-Projekt anlegen

- [ ] Supabase-Dashboard → eigene Org → "New project" (Free Plan reicht zum Start).
- [ ] Neue Projekt-Ref, URL, anon-Key und service_role-Key notieren.
- [ ] Datenbank-Passwort sicher notieren.

## 1.3 Schema einspielen (per CLI)

```
cd smartfox-eigen
supabase login
supabase link --project-ref <NEUE_PROJECT_REF>
supabase db push
```

`db push` spielt alle Migrations aus `supabase/migrations/` in der richtigen Reihenfolge ein.

- [ ] Nach dem Push: im neuen Projekt prüfen, ob alle Tabellen existieren.
- [ ] **RLS-Policies kontrollieren** (waren mühsam aufgesetzt – genau prüfen, ob alle aktiv sind).

## 1.4 Alle 23 Edge Functions deployen

```
supabase functions deploy
```

(deployt alle auf einmal; alternativ einzeln mit `supabase functions deploy <name>`)

Checkliste der 23 Functions:

- [ ] aggregate-energy-data
- [ ] ai-daily-planner
- [ ] ai-parameter-advisor
- [ ] ai-parameter-evaluator
- [ ] analysis-scheduler
- [ ] analysis-summary
- [ ] analyze-patterns
- [ ] analyze-solar-gain
- [ ] auto-resolve-api-errors
- [ ] battery-soc-decision
- [ ] calculate-heating-power
- [ ] compute-daily-score
- [ ] evaluate-decision
- [ ] fetch-energy-prices
- [ ] fetch-pv-forecast
- [ ] fetch-weather
- [ ] ml-feature-extraction
- [ ] monitor-solar-heating
- [ ] pv-automation
- [ ] tuya-control
- [ ] update-learned-policies
- [ ] validate-battery-reserve
- [ ] (23. Function: beim Deploy-Output gegenprüfen, ob alle erkannt wurden)

## 1.5 Secrets im neuen Projekt setzen

Für jedes benötigte Secret:

```
supabase secrets set NAME=wert
```

- [ ] Tuya-Zugangsdaten (für `tuya-control`)
- [ ] AI/Gemini-API-Key (für die ai-* Functions)
- [ ] Wetter-API-Key (für `fetch-weather`) – falls nötig
- [ ] Strompreis-API-Key (für `fetch-energy-prices`) – falls nötig
- [ ] Weitere aus der Secrets-Liste (Etappe 0)

## 1.6 Daten migrieren

- [ ] Aus altem Projekt exportieren (Supabase Dashboard → Database → oder `pg_dump` nur Daten: `--data-only`).
- [ ] In neues Projekt importieren.
- [ ] Reihenfolge wegen Foreign Keys beachten (oder FK-Checks temporär deaktivieren).
- [ ] Stichprobe: Zeilenzahlen vergleichen (z.B. `energy_readings`, `api_errors`).

## 1.7 PARALLEL testen (ohne Live-Umstellung!)

Während dieser Tests laufen Collector und Lovable-App UNVERÄNDERT weiter auf Lovable Cloud. Du testest nur die Kopie.

- [ ] Frontend lokal gegen neues Supabase starten: in `smartfox-eigen` eine lokale `.env` mit den NEUEN Werten (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`), dann `bun install` + `bun run dev`.
- [ ] App-Anmeldung + Datenanzeige prüfen.
- [ ] Eine Edge Function testweise aufrufen (z.B. `fetch-weather`) – läuft sie fehlerfrei?
- [ ] `tuya-control` NUR mit Bedacht testen (schaltet echte Thermostate!).

**Erst weitergehen, wenn die Kopie nachweislich funktioniert.**

---

# ETAPPE 2 — Umschalten (der Moment mit Risiko)

Erst starten, wenn Etappe 1 vollständig grün ist.

## 2.1 Collector umstellen

- [ ] In der Collector-`config.json` (`local-collector/`) `supabase_url` + `supabase_key` auf das NEUE Projekt ändern.
- [ ] NSSM-Service neu starten (`SmartfoxFronius` / der schreibende Service).
- [ ] Prüfen: kommen in `energy_readings` (neues Projekt) frische Zeilen mit aktuellem Timestamp an?

## 2.2 App / Hosting umstellen

- [ ] Da Lovable raus ist: Frontend selbst bauen (`bun run build`) und hosten (z.B. Vercel – ist bereits installiert).
- [ ] Produktions-Env-Variablen auf das neue Supabase setzen.
- [ ] Domain/Zugang prüfen.

## 2.3 Cron-Jobs / Scheduler neu einrichten

- [ ] Falls `analysis-scheduler` o.ä. zeitgesteuert lief: im neuen Projekt pg_cron/Scheduler neu konfigurieren (siehe Notizen aus Etappe 0).

## 2.4 Endkontrolle

- [ ] Collector schreibt durchgehend (Timestamps aktuell).
- [ ] App-Anmeldung + alle Ansichten funktionieren.
- [ ] KI-/Heizungs-Automatik läuft (Tuya schaltet, Pläne werden erzeugt).
- [ ] Keine Fehler in den Function-Logs des neuen Projekts.

## 2.5 Erst danach: Lovable rausnehmen

- [ ] Alte Lovable-Cloud-DB als Backup BEHALTEN, noch NICHT löschen (mind. einige Tage Parallelbetrieb beobachten).
- [ ] Wenn nach Beobachtungszeit alles stabil: Lovable-Projekt deaktivieren/archivieren.

---

# Rückfall-Plan (falls etwas schiefgeht)

- Collector-`config.json` zurück auf alte `supabase_url`/`key` (aus Etappe 0) → schreibt wieder in Lovable Cloud.
- App wieder über Lovable laufen lassen.
- Da die alte DB unangetastet blieb, ist jederzeit ein sauberer Rückfall möglich.

---

# Offene Punkte vorab mit Claude klären

- [ ] Genaue Secrets-Werte beschaffen (welche Quellen für Tuya / AI-Key / API-Keys?)
- [ ] Live in Lovable prüfen: Wie genau exportiert man die Daten aus Lovable Cloud (Dashboard-Export vs. pg_dump-Zugang)?
- [ ] Hosting-Entscheidung fürs Frontend final festlegen (Vercel?).
- [ ] Scheduler/Cron-Inventar erstellen (welche Functions laufen zeitgesteuert?).
