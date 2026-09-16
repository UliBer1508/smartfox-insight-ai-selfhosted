# FIX: Haustür-IP, api_errors-Flut, Watchdog-Fehlalarm, tuya-control /test

**Datum:** 16. September 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted`
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffen:** Collector `index.js`, Edge Function `auto-resolve-api-errors`, Edge Function `tuya-control`, Frontend `TuyaConnectionTest.tsx`, pg_cron Job 25

**Zusammenfassung:** Ausgangspunkt war ein roter Fehlerbalken im API-Verbindungstest (Kosmetik). Dahinter kamen vier unabhängige, real wirksame Fehler zum Vorschein — darunter ein Thermostat, das seit drei Wochen unbemerkt offline war, und ein Watchdog, der seit zweieinhalb Monaten täglich falschen Alarm schlug.

---

## 1. Haustür seit 3 Wochen offline (DHCP-IP gewandert)

### Symptom
Jeder Sync-Zyklus endete identisch:
```
[Tuya] Sync fertig in 4.0s — OK: 11/12, Fehler: 1 (offline: 1)
```
Das fehlende Gerät war immer "Haustür". Alle 5 Minuten zusätzlich:
```
[Version] Haustür setMode: 3.5 fehlgeschlagen, versuche 3.3...
[Retry] Haustür set 1/2...
```

### Diagnose
Die letzte erfolgreiche Lesung stand bei Zeile 35.732 von 138.695 im `service.log` — danach nie wieder. Bei 5-Minuten-Takt entspricht das **rund drei Wochen Dauerausfall**.

Die 3.5→3.3-Meldung war eine **Fehlspur**: Das ist nur die normale Fallback-Kette, die bei einem unerreichbaren Gerät zwangsläufig auch scheitert. Die Ursache lag davor — der TCP-Preflight auf Port 6668.

Drei verschiedene IPs in drei Quellen:

| Quelle | Haustür-IP |
|---|---|
| laufende `config.json` | 192.168.188.149 |
| `snapshot.json` / v2-Ordner | 192.168.188.174 |
| **FritzBox (tatsächlich)** | **192.168.188.137** |

### Ursache
Die DHCP-Adresse ist mindestens zweimal gewandert (.174 → .149 → .137). Der Collector macht **vor** dem Verbinden einen TCP-Preflight auf die konfigurierte IP. Schlägt der fehl, wird das Gerät sofort als offline markiert — die `device.find()`-Broadcast-Suche von tuyapi, die das sonst auffangen würde, kommt gar nicht mehr zum Zug. Deshalb heilt sich dieser Fall **nicht** von selbst.

### Fix
IP in `C:\Users\ulibe\tuya-thermostat\config.json` auf `192.168.188.137` korrigiert, Dienst neu gestartet.

Ergebnis: `OK: 12/12, Fehler: 0 (offline: 0)`

**Dauerhaft abgesichert:** Allen 12 Thermostaten in der FritzBox feste IPs zugewiesen (Heimnetz → Netzwerk → Stift → "Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen").

### Nebenbefund
Die FritzBox meldet das Thermostat als "LAN, verbunden mit Switch" — vermutlich hängt es an einem Repeater oder Powerline-Adapter. Falls dieser Zwischenweg instabil ist, könnte das die frühere Log-Phase mit 5–10 gleichzeitig offline erklären.

---

## 2. api_errors-Flut: ~300 Zeilen pro Tag für ein einziges Gerät

### Symptom
```sql
select date_trunc('day', created_at) as tag, count(*) from api_errors group by 1 order by 1 desc;
```
```
03.09. bis 15.09.  →  konstant 304-333 Einträge pro Tag
```
Das entspricht **einem Eintrag alle 4,8 Minuten** — exakt dem Haustür-Sync-Takt. Praktisch das gesamte Aufkommen ging auf dieses eine Gerät zurück.

### Ursache
Der Collector legte bei **jedem** Sync-Zyklus einen neuen Datensatz an, statt einen bestehenden offenen Eintrag zu aktualisieren. Die Spalte `retry_count` existierte, war aber ungenutzt (immer `0`).

Zweiter Fehler an derselben Stelle: Der `insert` setzte `room_id` **nicht**. Das hatte Folgen für die Auflösungslogik (siehe Punkt 3).

### Fix (Collector `index.js`, 606 → 636 Zeilen)
Neue Funktion `logDeviceError(device, errorType, message)` ab Zeile 207, die beide bisherigen Inserts ersetzt (vormals Zeile 224 und 297):

```js
async function logDeviceError(device, errorType, message) {
  try {
    const { data: open, error: selErr } = await supabase
      .from('api_errors')
      .select('id, retry_count')
      .eq('device_id', device.device_id)
      .eq('error_type', errorType)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (selErr) { console.error('[api_errors] Abfrage fehlgeschlagen:', selErr.message); return; }

    if (open && open.length > 0) {
      await supabase.from('api_errors').update({
        retry_count: (open[0].retry_count || 0) + 1,
        error_message: message
      }).eq('id', open[0].id);
      return;
    }

    await supabase.from('api_errors').insert({
      source: 'tuya-local',
      error_type: errorType,
      error_message: message,
      device_id: device.device_id,
      room_id: device.room_id || null,   // <-- fehlte vorher
      room_name: device.name
    });
  } catch (e) {
    console.error('[api_errors] Logging fehlgeschlagen:', e.message);
  }
}
```

**Wichtig:** Es gibt zwei Collector-Ordner mit ähnlichem, aber nicht identischem Code:

| | `C:\Users\ulibe\tuya-thermostat` | Fronius-Collector-Ordner |
|---|---|---|
| Rolle | Thermostat-Steuerung | Fronius-Daten |
| `index.js` | 636 Zeilen, **LF** | 582 Zeilen, **CRLF** |
| `config.json` | 12 Tuya-Geräte | nur Fronius |

Gepatcht wurde **nur der Tuya-Ordner**. Im Fronius-Ordner läuft `syncThermostats()` nie (kein `tuya.devices`-Block).

---

## 3. Selbstheilung prüfte das Falsche (bis zu 2 h Fehleranzeige)

### Symptom
Nach Behebung von Punkt 1 lieferte Haustür wieder frische Daten, aber 24 `api_errors`-Einträge blieben offen. Der Cron-Job `auto-resolve-api-errors` (alle 5 Min) löste pro Durchlauf nur **einen** auf.

### Ursache
Block 2 der Function kannte nur zwei Bedingungen:

```js
// (a) Raum hat einen ausgeführten Command in den letzten 30 Min
if (err.room_id) { ... .eq('status','executed').gte('executed_at', thirtyMinAgo) ... }

// (b) ODER: Fehler ist älter als 2 Stunden
if (!resolve && new Date(err.created_at).getTime() < twoHoursAgo) resolve = true;
```

Beide griffen nicht:
- **(a) war toter Code**, weil der Collector `room_id` nicht mitschrieb (siehe Punkt 2). `if (err.room_id)` war nie wahr.
- Selbst mit korrektem `room_id` hätte (a) kaum geholfen: Commands kamen nur stündlich und standen alle auf `failed`.
- Blieb **(b)** — und die löst nur einzeln auf, in der Reihenfolge des Alters. Daher genau ein Eintrag pro Durchlauf.

**Kernproblem:** Die Logik fragte "wurde ein Kommando ausgeführt?" statt "ist das Gerät wieder erreichbar?". In Phasen ohne Heizbedarf (Sommer, alle Räume über Zieltemperatur) bedeutet das bis zu zwei Stunden Fehleranzeige, obwohl `service_health` längst 12/12 meldet.

### Fix (`auto-resolve-api-errors/index.ts`)
Neue Bedingung (b), die über `device_id` gegen `rooms.tuya_device_id` auflöst — unabhängig von `room_id` und unabhängig davon, ob geheizt wird:

```js
const freshSyncMs = 10 * 60 * 1000;

// Geraete-Sync-Zeitpunkte EINMALIG vor der Schleife laden
const { data: roomSyncs } = await supabase
  .from('rooms')
  .select('tuya_device_id, last_thermostat_sync')
  .not('tuya_device_id', 'is', null);

const syncByDevice = new Map(
  (roomSyncs ?? []).map(r => [r.tuya_device_id, r.last_thermostat_sync])
);

// ... in der Schleife, zwischen (a) und der 2-Stunden-Regel:
if (!resolve && err.device_id) {
  const lastSync = syncByDevice.get(err.device_id);
  if (lastSync && (now - new Date(lastSync).getTime()) < freshSyncMs) {
    resolve = true;
    reachableCount++;
  }
}
```

Zusätzlich wird `device_id` jetzt mit ausgelesen (vorher nur `id, room_id, created_at`), und der Rückgabewert enthält `device_reachable_resolved` zur Beobachtung.

### Verifikation
Der Verlauf der offenen Einträge belegt den Fix:
```
24 → 23 → 16 → 0
```
Die 2-Stunden-Regel löst nur einzeln auf (Schritte 24→23, 23→16). Dass die restlichen **16 auf einen Schlag** verschwanden, direkt nach dem Deploy, kann nur Bedingung (b) gewesen sein — ihre jüngsten Einträge waren noch keine zwei Stunden alt.

---

## 4. Watchdog mit unerreichbarer Schwelle (Fehlalarm seit 03.07.)

### Symptom
Offener Eintrag in `api_errors`:
```
pv-accuracy-watchdog | fetch_failed | record-pv-accuracy: kein gültiger Eintrag für 2026-09-15
```

Der Eintrag für den 15.09. existierte aber sehr wohl — und war mit 72,5 kWh Prognose gegen 70,78 kWh tatsächlich sogar ein sehr guter Tag.

### Ursache
pg_cron Job 25 prüfte:
```sql
where not exists (
  select 1 from pv_forecast_accuracy
  where date = current_date - 1
    and samples > 500        -- <-- unerreichbar
);
```

Tatsächlich liefert das System konstant **282 Samples pro Tag**. Die Bedingung war an jedem Tag unerfüllbar.

**Warum 500 einmal sinnvoll war:** Am 03.07. (siehe `FIX-PV-ACCURACY-CRON-UND-WATCHDOG-2026-07-03.md`) sollte die Schwelle einen echten Nachtlauf von einem bloßen Mittagstest unterscheiden. Damals lieferte das System ~2.868 Messwerte pro Tag (Polling alle 30 s).

**Was sich änderte:** Das Polling-Intervall stieg auf **300 Sekunden**. Aus 2.868 Messwerten wurden ~288 pro Tag (282 nach Abzug kleiner Lücken). Die Schwelle 500 wurde damit unerreichbar.

### Nachweis
```sql
select count(*) as alarme, count(distinct date_trunc('day', created_at)) as betroffene_tage,
       min(created_at) as erster, max(created_at) as letzter
from api_errors where source = 'pv-accuracy-watchdog';
```
```
alarme: 70 | betroffene_tage: 69 | erster: 2026-07-03 | letzter: 2026-09-16
```

Lückenlos seit dem Tag der Einrichtung. Dass es nie auffiel, liegt am 24-Stunden-Sicherheitsnetz in `auto-resolve-api-errors`, das die Einträge stillschweigend wieder schloss.

### Fix
Schwelle auf `150` gesetzt (gut die Hälfte des Erwartungswerts 282 — erkennt echte Ausfälle, löst bei normalen Schwankungen nicht aus):

```sql
select cron.schedule('pv-accuracy-watchdog', '0 6 * * *', $$
  insert into api_errors (source, error_type, error_message)
  select 'pv-accuracy-watchdog', 'fetch_failed',
         'record-pv-accuracy: kein gültiger Eintrag für ' || (current_date - 1)::text
  where not exists (
    select 1 from pv_forecast_accuracy
    where date = current_date - 1
      and samples > 150
  );
$$);
```

**Hinweis:** `cron.schedule` mit identischem Namen überschreibt den bestehenden Job. Ein separates `cron.unschedule` ist überflüssig und wäre riskanter (Lücke zwischen Löschen und Neuanlegen). Job-ID 25 blieb erhalten.

Altlasten geschlossen:
```sql
update api_errors set resolved_at = now()
where source = 'pv-accuracy-watchdog' and resolved_at is null;
```

---

## 5. tuya-control /test: 500 statt sauberer Meldung

### Symptom
Die Karte "API-Verbindungstest" zeigte:
```
Zugangsdaten: Nicht konfiguriert
Verbindungsfehler: Edge Function returned a non-2xx status code
```

### Ursache
Der globale Credential-Check stand **vor** dem Routing und warf bei fehlenden Keys sofort:

```js
const accessId = Deno.env.get('TUYA_ACCESS_ID')?.trim();
const accessSecret = Deno.env.get('TUYA_ACCESS_SECRET')?.trim();
if (!accessId || !accessSecret) {
  throw new Error('Tuya credentials not configured');   // -> äußeres catch -> HTTP 500
}
```

Der `/test`-Handler weiter unten hatte für genau diesen Fall bereits eine saubere Lösung (`credentials_configured: false`, Status 200) — sie war aber **toter Code**, weil sie nie erreicht wurde.

### Fix
`url`/`path` vor den Check gezogen, `/test` ausgenommen:

```js
const accessId = Deno.env.get('TUYA_ACCESS_ID')?.trim() as string;
const accessSecret = Deno.env.get('TUYA_ACCESS_SECRET')?.trim() as string;

const url = new URL(req.url);
const path = url.pathname.replace('/tuya-control', '');

// /test darf auch OHNE Credentials laufen: Der Handler meldet genau diesen
// Zustand sauber zurueck (credentials_configured: false, Status 200).
if ((!accessId || !accessSecret) && path !== '/test') {
  throw new Error('Tuya credentials not configured');
}

if (accessId) console.log('Using accessId:', accessId, 'length:', accessId.length);
```

Alle anderen Pfade (`/set-temp`, `/sync-all`, `/push-all-temps`, `/switch`) verhalten sich unverändert. Die Cloud-Fähigkeit bleibt vollständig erhalten.

**Kontext:** Die Tuya-Cloud-Lizenzen sind abgelaufen und werden bewusst nicht erneuert. Das System läuft rein lokal (`tuya_control_mode = local`). "Nicht konfiguriert" ist damit der **korrekte** Zustand, kein Fehler.

---

## 6. Frontend: Karte benannte die Cloud-API nicht

### Symptom
Die Karte hieß schlicht "API-Verbindungstest". Dass damit die **Tuya Cloud** gemeint ist und nicht die lokale LAN-Steuerung, ging aus der Oberfläche nicht hervor. In einem lokal betriebenen System sieht das aus wie ein Problem, obwohl keines vorliegt. Die Statuszeile meldete zudem pauschal "Verbindungsproblem".

### Fix (`src/components/settings/TuyaConnectionTest.tsx`)
- Titel: **"Tuya Cloud API-Verbindungstest"**, darunter "Prüft die Verbindung zur Tuya Cloud (nicht die lokale LAN-Steuerung)."
- Karte kennt den Steuermodus über den vorhandenen Hook `useControlMode`
- Bei `mode === 'local'`:
  - Hinweisfeld: "Lokaler Service-Modus aktiv — fehlende Zugangsdaten sind hier kein Fehler"
  - Kein Auto-Test beim Öffnen (Knopf "Testen" bleibt funktionsfähig)
  - Status-Badge "Nicht in Verwendung" (neutral) statt "Verbindungsproblem" (gelb)
  - "Zugangsdaten" grau statt rot; Warnfeld "Zugangsdaten fehlen" entfällt
- Im Cloud-Modus unverändertes Verhalten (Multi-Region-Check, Quota-Warnungen, Regionenwechsel)

---

## 7. Infrastruktur: lokaler Repo-Klon auf dem Österreich-PC

Bisher wurde vom Österreich-PC aus über den GitHub-Web-Editor gearbeitet. Für diese Session wurde ein Klon eingerichtet:

```powershell
git clone https://github.com/UliBer1508/smartfox-insight-ai-selfhosted.git C:\Heizung\repo
cd C:\Heizung\repo
supabase link --project-ref pflnniklvqbwjwrjswaz
```

### Stolperstein: Checkout schlug komplett fehl
```
error: invalid path 'doc/Fix-Dokumentation: KI-Tagesplaner & KI-Autopilot'
```
`git ls-files` lieferte **0**, der Arbeitsbereich enthielt nur `.git`.

**Ursache:** Der **Doppelpunkt** im Dateinamen. Unter Linux und in GitHubs Weboberfläche zulässig, unter Windows verboten (dort trennt `:` den Laufwerksbuchstaben). Git bricht beim ersten ungültigen Pfad komplett ab.

Die Datei stammte aus einem Web-Upload — beim Anlegen über den Browser greift keine Windows-Prüfung.

**Sparse-Checkout half nicht:** Git prüft *alle* Index-Einträge auf Gültigkeit, bevor es irgendetwas schreibt. Die Prüfung läuft vor der Filterung.

**Lösung:** Datei auf GitHub umbenannt in `FIX-KI-TAGESPLANER-UND-KI-AUTOPILOT-2026-06-30.md`, dann:
```powershell
git fetch origin
git reset --hard origin/main   # -> Updating files: 100% (391/391), done.
```

**Prüfung auf weitere Fälle:**
```powershell
git ls-tree -r --name-only HEAD | Select-String '[:*?"<>|]'
```

### Weitere Beobachtungen
- `supabase link` verändert `supabase/.temp/gotrue-version` und `storage-version`. Das sind CLI-Zwischenstände und gehören **nicht** ins Repo → `supabase/.temp/` sollte in die `.gitignore`.
- `supabase functions invoke` existiert in dieser CLI-Version nicht. Ersatz per HTTP:
  ```powershell
  Invoke-RestMethod -Method Post -Uri "https://<ref>.supabase.co/functions/v1/<name>" `
    -Headers @{ "Authorization"="Bearer $anon"; "apikey"=$anon; "Content-Type"="application/json" }
  ```
- `net stop/start` braucht eine **als Administrator** gestartete PowerShell.

---

## 8. Offene Punkte

1. **Messfrequenz 300 statt 30 Sekunden** — die Datengrundlage ist gegenüber Juli um **Faktor zehn** dünner (2.868 → 282 Messpunkte pro Tag). Für Tagessummen unkritisch, für ML-Feature-Extraktion und Lernmodelle möglicherweise relevant. Erst messen, was die Modelle brauchen, dann entscheiden.
2. **`supabase/.temp/` in die `.gitignore`**
3. **Dreifacher pv-automation-Trigger** — beide Collector rufen die Function auf, dazu Cron-Job 5 alle 2 Minuten. Vermutlich harmlos (Prüflauf, `heating_settings` bleibt Quelle der Wahrheit), könnte aber die historischen 502er und `socket hang up` erklären.
4. **`auto-discovery.js` hat eine veraltete IP-Liste** — enthält weder .137 noch .149 noch .174. Das Skript hätte Haustür nie gefunden.

---

## 9. Gelernt

1. **Ein Preflight kann die Selbstheilung aushebeln.** tuyapi findet Geräte per UDP-Broadcast auch bei falscher IP — aber nur, wenn der Code sie überhaupt erst kontaktiert. Ein vorgeschalteter TCP-Check auf die konfigurierte Adresse macht diese Fähigkeit wirkungslos.
2. **Fehlspuren erkennen.** Die "3.5 fehlgeschlagen, versuche 3.3"-Meldungen sahen nach einem Protokollproblem aus, waren aber nur Folgefehler. Die eigentliche Ursache lag einen Schritt früher.
3. **Schwellwerte veralten mit ihren Annahmen.** Die `samples > 500` war bei 30-Sekunden-Polling korrekt. Als sich das Intervall verzehnfachte, wurde sie stillschweigend unerreichbar. Bei jeder Änderung an Messfrequenzen die davon abhängigen Schwellen mitprüfen.
4. **Ein stilles Sicherheitsnetz verdeckt Dauerfehler.** Das 24-Stunden-Auto-Resolve schloss 69 Tage lang jeden Watchdog-Fehlalarm, bevor jemand ihn sah.
5. **Aggregat-Zahlen prüfen, bevor man handelt.** Die Schätzung "~6.000 offene Einträge" lag um Faktor 250 daneben — es waren 24. Erst zählen, dann aufräumen.
6. **Selbstheilung an Erreichbarkeit hängen, nicht an Aktivität.** "Wurde ein Kommando ausgeführt?" ist ein schlechter Gesundheitsindikator, wenn in Ruhephasen gar keine Kommandos anfallen.
7. **Windows-Dateinamen:** `: * ? " < > |` blockieren den gesamten Git-Checkout, nicht nur die betroffene Datei. Bei Web-Uploads nach GitHub gibt es keine Schutzprüfung.
