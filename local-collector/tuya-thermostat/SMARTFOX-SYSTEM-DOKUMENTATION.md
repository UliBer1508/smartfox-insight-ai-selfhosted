# Smartfox Heizungssteuerung – System-Dokumentation

**Stand:** 18. Juni 2026
**Repo:** `UliBer1508/smartfox-insight-ai`
**Zweck:** Vollständige Referenz für Architektur, Datenfluss, Zeitlogik und bekannte Fehler. Damit Diagnose und Reparatur nicht jedes Mal von vorn beginnen.

---

## 1. Gesamtarchitektur in einem Bild

Das System besteht aus drei Teilen, die NUR über die Datenbank (Supabase) miteinander reden. Es gibt KEINE direkte Verbindung von der Cloud zu deinem PC.

```
   DEIN PC (Österreich)                  SUPABASE (Cloud)                 APP / DASHBOARD
   ─────────────────────                 ─────────────────                ────────────────
   Collector (index.js)                  Tabellen:                        ThermostatCard.tsx
   als NSSM-Dienst                       - rooms                          HeatingDashboard.tsx
   "SmartfoxTuya"                        - thermostat_commands
        │                                - service_health                 liest rooms +
        │ liest/schreibt  ◄────────────► - api_errors                     api_errors
        │                                - energy_readings
        ▼                                - system_settings
   12 Tuya-Thermostate                        ▲
   lokal über TCP 6668                         │ liest/schreibt
                                          pv-automation (Edge Function)
                                          läuft als Cron alle ~2 Min
                                          = alleinige Setpoint-Autorität
```

**Merksatz:** Der Collector ist Hände und Augen (liest Temperaturen, führt Befehle aus). Die pv-automation ist das Gehirn (entscheidet, welche Temperatur wann). Die Datenbank ist das Nervensystem dazwischen.

---

## 2. Die drei Komponenten im Detail

### 2.1 Collector (`local-collector/collector-node/index.js`)

Läuft auf dem PC als Windows-Dienst `SmartfoxTuya` (via NSSM, Konto LocalSystem).

**Was er tut, in einer Schleife (Polling, Default alle 60 s):**
1. `fetchFroniusData()` – holt PV-Daten vom Fronius-Wechselrichter. **Bei dir nicht konfiguriert** (kein `fronius`-Block in config.json) → wird sauber übersprungen.
2. `processCommands()` – liest offene Befehle aus `thermostat_commands` (Status `pending`) und führt sie an den Thermostaten aus (set_temp, set_mode).
3. `triggerPvAutomation()` – ruft alle 2 Min die Edge Function pv-automation auf.
4. `syncThermostats()` – liest alle 12 Thermostate aus, schreibt Temperaturen nach `rooms`, und schreibt den **Heartbeat** nach `service_health`.

**Wichtige Konfigurationsabhängigkeiten in config.json:**
- `tuya.enabled` MUSS `true` sein, sonst überspringt der Collector alle Thermostate ("Tuya: Deaktiviert").
- `tuya.devices[]` – Liste mit name, room_id, device_id, local_key, ip pro Thermostat.
- `supabase.url` und `supabase.anon_key` (oder service_role_key).
- KEIN `fronius`-Block nötig (Code ist dagegen abgesichert).

### 2.2 pv-automation (`supabase/functions/pv-automation/index.ts`)

3810 Zeilen Deno/TypeScript. Läuft serverseitig in der Cloud, getriggert per Cron (~alle 2 Min) und zusätzlich vom Collector. **Einzige Instanz, die Setpoints festlegt.**

**Hauptablauf bei POST /check:**
1. Tuya-API-Quota + Kanal-Gesundheit prüfen (Zeile ~381)
2. Steuermodus bestimmen (cloud/local)
3. Prüfen ob lokaler Service online: `service_health.last_sync` < 5 Min (Zeile ~416)
4. Alle automatisierten Räume laden (Zeile ~1101)
5. PV-Budget, Batterie-SOC, Tagesprognose berechnen
6. Nacht-/Eco-/Komfort-Logik anwenden
7. Pro Raum entscheiden: activate / deactivate / keep
8. Setpoints in `thermostat_commands` schreiben (im Local-Modus) oder direkt über Tuya-Cloud (im Cloud-Modus)

**Zentrale Zeitfunktion `isNightTime()` (Zeile 19–49):** Korrekt implementiert. Rechnet in Europe/Vienna, behandelt Mitternachts-Übergang. Default-Nachtfenster 22:00–06:00, bei dir 22:00–08:00.

### 2.3 Dashboard (`src/components/heating/ThermostatCard.tsx`)

Zeigt pro Raum eine Karte. **Zwei verschiedene "Offline"-Anzeigen:**
- **Badge oben rechts** (Zeile ~194): kommt aus `api_errors`, NICHT aus rooms. Ein Raum ist "Offline", sobald ein offener (resolved_at IS NULL) Fehler mit seiner room_id existiert. Gepollt alle 30 s via React Query.
- **Text unten** (Zeile ~526): prüft `rooms.last_thermostat_sync` > 2 h. Separate Anzeige.

**Wichtig:** Das Badge hängt NICHT an der Temperatur. Selbst bei aktuellen Werten zeigt es "Offline", wenn in api_errors ein offener Fehler steht.

---

## 3. Datenfluss: Wie ein Befehl von der App zum Thermostat kommt

```
App (User stellt Temp)
   └─► INSERT in thermostat_commands (status=pending)
          └─► Collector pollt (alle 60s), processCommands()
                 └─► setTemperature() an Tuya-Gerät (TCP 6668)
                        └─► UPDATE thermostat_commands (status=executed)
                               └─► api_errors für dieses Gerät auf resolved gesetzt
```

Und die Automatik:
```
pv-automation (Cron alle 2 Min)
   └─► berechnet Soll-Temp pro Raum
          └─► INSERT in thermostat_commands (im Local-Modus)
                 └─► weiter wie oben
```

---

## 4. Die "Online/Offline"-Kette (häufigste Fehlerquelle)

Damit ein Raum als ONLINE gilt, müssen ZWEI Dinge stimmen:

1. **Heartbeat frisch:** Collector schreibt `service_health.last_sync` bei jedem Sync. pv-automation gilt den Service nur als aktiv, wenn dieser < 5 Min alt ist (Zeile 416). Fehlt der Heartbeat → pv-automation schreibt laufend `local_service_offline` in api_errors → Badge wird rot.

2. **Keine offenen api_errors:** Solange ein offener Fehler mit der room_id existiert, zeigt das Dashboard "Offline".

**Diagnose-Reihenfolge bei "Offline trotz funktionierender Temperaturen":**
- Schreibt der Collector `service_health.last_sync` frisch? (DB-Abfrage)
- Läuft `tuya.enabled=true` und der Dienst auf RUNNING?
- Stehen offene Einträge in api_errors für den Raum?

---

## 5. Zeit- und Zeitzonenlogik (kritischer Bereich)

Der Server (Supabase Edge) läuft in **UTC**. Deine Ortszeit ist **Europe/Vienna** (UTC+2 im Sommer). Alle Zeitstempel in der DB sind UTC. Das ist normal und korrekt – ein DB-Wert von `03:46 UTC` ist `05:46` Wiener Zeit.

**Korrekte Muster im Code (Vorbild):**
- `new Intl.DateTimeFormat('...', { timeZone: 'Europe/Vienna', ... }).format(now)` → liefert direkt Wien-Zeit als Text.
- `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })` → Wien-Datum.
- `isNightTime()` (Zeile 19–49) – sauberes Vorbild.

**Fehlerhaftes Muster (siehe Abschnitt 6):** `new Date(new Date().toLocaleString(..., {timeZone:'Europe/Vienna'}))` – der doppelte Cast verschiebt die Zeit erneut um den UTC-Offset.

---

## 6. GEFUNDENE FEHLER (mit exakter Fundstelle)

### FEHLER 1 – Doppelter Zeitzonen-Cast (Stundenversatz) ⚠️ HAUPTVERDÄCHTIGER für "6 statt 7 Uhr"

**Fundstellen:** `pv-automation/index.ts` Zeile **735** und Zeile **2425**

```js
const wienNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
```

**Problem:** `toLocaleString` erzeugt einen Text in Wien-Zeit (z.B. "6/18/2026, 7:48:00 AM"). `new Date(text)` liest diesen Text aber als **Server-Lokalzeit (UTC)** wieder ein. Ergebnis: Die Stunde ist erneut um den UTC-Offset (2 h im Sommer) verschoben. Ein späteres `.getHours()` liefert dann 5 statt 7 bzw. einen falschen Wert.

**Auswirkung:** `wienNow.getHours()` in Zeile 738–739 wird falsch → der "Nacht-Schlüssel" (nightKey) und Tagesstart-Berechnungen können um Stunden/einen Tag daneben liegen. Erklärt Anzeigen wie "Prozess startet 6 Uhr" wo 7 gemeint ist.

**Fix:** Stunde/Minute direkt aus dem Formatter ziehen, NICHT über new Date():
```js
const wienHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
const wienMinute = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna', minute: '2-digit' }));
```
(So wie es Zeile 1472–1473 bereits korrekt machen.)

### FEHLER 2 – Falscher slice-Index beim Tagesdatum 🐛 SICHER

**Fundstelle:** `pv-automation/index.ts` Zeile **1101**

```js
const todayStr = new Date().toISOString().slice(1,10);
```

**Problem:** `.slice(1,10)` schneidet ab Position 1 → ergibt `026-06-18` statt `2026-06-18` (erste Jahresziffer fehlt). Verifiziert.

**Auswirkung:** `todayStr` wird als `valid_for_date`-Filter genutzt (Zeile 1121, 1143), um den KI-Tagesplan zu laden. Da das Datum nie matcht, wird der KI-Tagesplan faktisch nie gefunden → Räume bekommen kein KI-Ranking. Zusätzlich nutzt der Code UTC statt Wien-Zeit hier.

**Fix:**
```js
const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD in Wien
```
(Behebt slice-Bug UND Zeitzone in einem.)

### HINWEIS 3 – `slice(1,10)` vs `slice(0,10)` Inkonsistenz

Zeile 742 macht es korrekt (`slice(0, 10)`), Zeile 1101 falsch (`slice(1,10)`). Das bestätigt, dass 1101 ein Tippfehler ist.

---

## 7. Was NACHWEISLICH KORREKT ist (nicht anfassen)

- `isNightTime()` (Zeile 19–49) – Zeitzonenlogik sauber.
- Heartbeat in service_health (Collector, neu eingebaut) – funktioniert, last_sync wird frisch geschrieben, devices_ok=12.
- Fronius-Absicherung mit `?.` (Collector Zeile 134, 138, 551) – verhindert Absturz ohne fronius-Block.
- Quota-/Monats-/Tagesreset (Zeile 489–521) – nutzt korrekt Intl mit Vienna.
- Mitternachts-Übergang der Nachtlogik – korrekt behandelt.
- SOC-Tracking (Zeile 1469 ff.) – nutzt korrektes Vienna-Muster.

---

## 8. Konfigurations-Stolpersteine (für DEINE Anlage dokumentiert)

1. **Kein fronius-Block:** config.json enthält keinen `fronius`-Abschnitt. Dieser Collector macht NUR Tuya. Code ist dagegen abgesichert.
2. **tuya.enabled = true ZWINGEND:** Fehlt der Schalter, werden alle Thermostate übersprungen.
3. **Dienst-Konto LocalSystem + Firewall:** Der NSSM-Dienst braucht eine ausgehende Firewall-Regel für TCP 6668 (alle Profile), sonst Timeout zu den Geräten:
   `New-NetFirewallRule -DisplayName "Smartfox Tuya out 6668" -Direction Outbound -Protocol TCP -RemotePort 6668 -Action Allow -Profile Any`
4. **Nachtabsenkung:** 22:00–08:00 setzt alle Räume auf 5°C (Frostschutz/kein Heizen). Geplantes Verhalten, kein Fehler.
5. **anon_key vs service_role_key:** Collector nutzt service_role_key, falls vorhanden, sonst anon_key. Für service_health/rooms-Schreibzugriff reicht der anon_key aktuell (Schreiben funktioniert).

---

## 9. Sicherheits-Hinweis (separat, nicht dringend)

Der Supabase `anon_key` und die Local-Keys der Thermostate liegen im öffentlichen GitHub-Repo (config-Beispiele / generate-config). Der anon_key ist mit aktivem RLS weniger kritisch. Falls je ein `service_role_key` eingecheckt wurde: in Supabase rotieren (umgeht RLS komplett). Local-Keys ermöglichen lokale Gerätesteuerung im LAN.

---

## 10. Standard-Diagnosebefehle (PowerShell, am PC)

Dienststatus:
```
Get-Service SmartfoxTuya
```
Heartbeat prüfen (last_sync muss < 5 Min alt sein):
```
$h=@{apikey="<anon_key>"}; Invoke-RestMethod -Uri "https://tvqmhdpcixkfsudxughs.supabase.co/rest/v1/service_health?service_name=eq.tuya-thermostat&select=*" -Headers $h | ConvertTo-Json
```
Letzte Logzeilen:
```
Get-Content C:\Users\ulibe\tuya-thermostat\service.log -Tail 30
```
Prüfen ob tuya aktiv:
```
Get-Content C:\Users\ulibe\tuya-thermostat\config.json | Select-String "enabled"
```
