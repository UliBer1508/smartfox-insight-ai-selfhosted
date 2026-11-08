# Systemstatus – laufen alle Prozesse? (05.11.2026)

**Wunsch (Uli, 05.11.2026):** Auf einen Blick sehen, ob alle Prozesse laufen – auf dem PC in München, dem PC in
Österreich und in der Cloud – und sie auch steuern können. Anlass: Eine Woche lang kein Zugriff auf den
München-PC, weil Tailscale nicht lief. Hätte er es aus der Ferne starten können, wäre das Problem gelöst gewesen.
Vorbild: das Dienste-Fenster im Wallbox Manager (`Wallbox-Backend/src/services.js`).

**Entscheidungen (05.11.2026):** Symbol in der Kopfleiste (Mockup „passt“) · alles auf beiden PCs installiert ·
bei Problemen eine Mail.

---

## 1. Warum nicht 1:1 wie im Wallbox Manager

Das Wallbox-Backend läuft **auf** dem Österreich-PC und ruft `nssm` direkt auf. Die Heizungs-App läuft in der
Cloud (Vercel) und hat keine Verbindung zu den PCs – alles geht über Supabase (Systemdoku §1). Deshalb gibt es
auf jedem PC einen kleinen **Dienste-Wächter**, der sich bei Supabase meldet – nach demselben Muster wie die
Thermostat-Befehle (`thermostat_commands`).

```
 Österreich-PC / München-PC              Supabase                                App (Kopfleiste)
 ─────────────────────────               ─────────────────────────               ─────────────────
 DiensteWaechter (NSSM)  ── alle 30 s ─► Edge Function system-agent              Symbol: ● / „1 Problem“
   findet NSSM-Dienste       HTTPS       → system_hosts, system_services   ◄──── liest alle 30 s
   + Tailscale               (Token)     ← offene service_commands         ◄──── Start/Stop/Neustart
   führt Befehle aus                     system_problems()  ◄───────────────── dieselbe Liste
                                         system-alert (Cron 5 min)
                                           prüft Webseiten, schickt Mail
```

**Der Kern:** Der Wächter baut die Verbindung selbst nach außen auf. Er braucht weder Tailscale noch
Cloudflare. Steht Tailscale, meldet der Wächter das, und das „Start“ aus der App kommt trotzdem an.

Ist ein PC ganz aus oder ohne Internet, kann man aus der Ferne nichts tun. Die App zeigt dann
„München-PC meldet sich nicht seit …“, und es kommt eine Mail.

## 2. Was angezeigt wird

| Bereich | Quelle | Problem, wenn … |
|---|---|---|
| PC meldet sich | `system_hosts.last_seen` (Wächter alle 30 s) | länger als 10 min still |
| Dienste je PC (NSSM + Tailscale) | `system_services` | gestoppt/unbekannt länger als 3 min – außer per App gestoppt |
| Heizungsautomatik | letzter erfolgreicher Cron-Lauf `pv-automation-check` | (nur Anzeige, Knopf „Jetzt ausführen“) |
| Fronius-Daten | letzte Zeile `energy_readings` | älter als 15 min |
| Thermostate | `service_health` (tuya-thermostat) | Herzschlag älter als 10 min |
| Thermostate einzeln (seit 08.11.) | `thermostat_state.read_at` (letzte echte Lesung) | älter als 15 min, solange der Thermostat-Dienst läuft |
| übrige Fehler (seit 08.11. je Quelle + Art) | `api_errors` offen, ohne `device_offline`/`connection_error` | länger als 15 min offen (sofort, wenn ein gleicher langer Fehler ≤ 10 min vorher geschlossen wurde) |
| Geplante Aufgaben | `cron.job_run_details` | Lauf mit Status „failed“ in 24 h |
| Function-Aufrufe | `net._http_response` | HTTP ≥ 400 in 2 h (ein 401 erscheint im Cron als „succeeded“ – siehe learnings) |
| Webseiten | `system_status_websites` → `system_services` (host `cloud`) | 5xx oder keine Antwort |

Alle Regeln stehen an **einer** Stelle: `system_problems()` (SQL 22). App und Mail benutzen dieselbe Liste.

Webseiten ändern: `system_settings.system_status_websites` (JSON-Liste `name`, `label`, `url`). Voreingestellt
sind die Heizungs-App und die Wallbox-Gästeseite – Letztere prüft Cloudflare-Tunnel und Wallbox-Backend gleich mit.

## 3. Steuern – Regeln

| Dienst | Steuerung |
|---|---|
| NSSM-Dienste (SmartfoxTuya, SmartfoxFronius, Wallbox-Backend, alexa-bridge, evcc …) | Start · Stop · Neustart |
| Fernzugriff: Tailscale, Cloudflare-Tunnel | **nur Start** – nie aus der Ferne abschalten |
| Dienste-Wächter selbst | nur ansehen (NSSM startet ihn nach einem Absturz neu) |
| Webseiten | nur ansehen |

- Nur **Admins** (`system_status_admins`, eingetragen: Uli) dürfen Befehle anlegen. Alle Angemeldeten sehen den Status.
- Die Regeln prüfen **drei** Stellen: die App (Knöpfe), die Datenbank (RLS + `service_command_allowed()`)
  und der Wächter selbst. Ein Name, den der Wächter auf seinem PC nicht gefunden hat, geht nie an die Shell.
- Stop fragt in der App nach. Ein per App gestoppter Dienst gilt nicht als Problem (`intended_stop`).
- Ein Befehl, den in 15 min niemand abholt, verfällt („nicht abgeholt“).
- Seit es den getrennten Wächter gibt, kann auch **SmartfoxTuya** gestoppt und wieder gestartet werden – die Falle
  „wer startet den Dienst, der Befehle ausführt?“ gibt es nicht mehr.

## 4. Mail

Edge Function `system-alert`, alle 5 min per Cron (`system-alert-5min`):

Seit 08.11.2026 (`doc/FIX-ALERT-MAILS-2026-11-08.md`): je Problem **genau zwei Mails**.
- **Problem**, das mindestens 4 min besteht → eine Mail mit Beschreibung und **Was tun** (Lösungsansatz je Problemart).
- **Gelöst** → eine Mail mit Dauer, erst wenn das Problem **15 min am Stück** weg ist (nur für vorher gemeldete Probleme).
  Kommt es innerhalb der 15 min zurück, gilt es als dasselbe Problem – keine neue Mail.
- Keine Erinnerung mehr nach 24 h (bis 07.11.2026); offene Probleme zeigt die App.
- Thermostate werden einzeln gemeldet, aus der letzten echten Lesung (`thermostat_state.read_at`), nicht aus `api_errors`.
- Versand über Gmail (Port 465), wie die Wallbox-Quittungen. Schlägt der Versand fehl, versucht es der nächste Lauf wieder.

Secrets (Supabase › Edge Functions › Secrets):

| Secret | Inhalt |
|---|---|
| `SYSTEM_AGENT_TOKEN` | zufällige Zeichenkette (mind. 24 Zeichen) – gleich in beiden `config.json` |
| `MAIL_USER` | Gmail-Absender (wie `MAIL_USER` in der Wallbox-`.env`) |
| `MAIL_PASS` | Google-App-Passwort (wie `MAIL_PASS` in der Wallbox-`.env`) |
| `ALERT_EMAIL` | Empfänger (mehrere mit Komma) |

Fehlen die Mail-Secrets, läuft alles andere trotzdem (Antwort der Function: „Mail nicht konfiguriert“).

## 5. Dateien

| Datei | Inhalt |
|---|---|
| `supabase/SQL/22_systemstatus.sql` | Tabellen, RLS, `system_problems()`, `system_cloud_status()`, Melde-Funktionen, Cron |
| `supabase/functions/system-agent/` | Schnittstelle für den Wächter (Token, `verify_jwt = false`) |
| `supabase/functions/system-alert/` | Webseiten prüfen, Probleme abgleichen, Mail |
| `local-collector/dienste-waechter/` | der Wächter (Node, ohne npm-Pakete), Vorlagen je PC, `install-dienst.bat`, README |
| `src/hooks/useSystemStatus.ts` | Daten für Kopfleiste und Fenster |
| `src/components/layout/SystemStatus.tsx` | Symbol + Fenster |

## 6. Inbetriebnahme

1. **SQL 22** im Supabase SQL-Editor ausführen. Prüfen:
   `select left(command, 120) from cron.job where jobname = 'system-alert-5min';` → enthält `/functions/v1/system-alert`.
2. **Secrets** anlegen (Tabelle in §4).
3. **Functions deployen:** `system-agent`, `system-alert` (GitHub-Aktion nach dem Merge oder
   `supabase functions deploy system-agent` / `system-alert` aus `C:\Heizung\repo`).
4. **App:** PR mergen → Vercel. Das Symbol erscheint erst, wenn SQL 22 eingespielt ist.
5. **Österreich-PC:** `git pull` in `C:\Heizung\repo`, dann in `local-collector\dienste-waechter`
   `config.oesterreich.example.json` → `config.json`, Token eintragen, `install-dienst.bat` als Administrator.
6. **München-PC:** Ordner `local-collector/dienste-waechter` von GitHub holen (z. B. nach
   `C:\Users\ulibe\dienste-waechter`), `config.muenchen.example.json` → `config.json`, Token eintragen,
   `install-dienst.bat` als Administrator.

**Stand 05.11.2026, 07:34:** beide PCs eingerichtet und melden sich.
- Österreich: `C:\Heizung\repo\local-collector\dienste-waechter` (7 Dienste). Neustart `alexa-bridge` aus der App getestet: 32 s vom Klick bis „neu gestartet“ (Wächter fragt alle 30 s).
- München: `C:\Users\ulibe\dienste-waechter`, Dateien per `Invoke-WebRequest` von GitHub geholt (kein Repo-Klon).
  `nssm.exe` liegt dort unter `C:\nssm\` und ist nicht im PATH – der Wächter findet es seit 6fc7340 selbst
  (aus dem ImagePath eines NSSM-Dienstes); `install-dienst.bat` benutzt den gefundenen Pfad.
- Stolpersteine: Das Repo-`package.json` setzt `type: module` → eigener `package.json` (CommonJS) im Wächter-Ordner.
  raw.githubusercontent.com liefert nach einem Push einige Minuten die alte Fassung – für sofortige Updates
  die Commit-Kennung statt `main` in die Adresse setzen.
- Mail (Secrets `MAIL_USER`, `MAIL_PASS`, `ALERT_EMAIL`) noch nicht eingerichtet.

**Nachtrag 05.11.2026 (Uli: „ich wollte es in beiden“):** Das Symbol gibt es auch in der App **Heizung München**
(Repo `heizung-muenchen`, `frontend/src/SystemStatus.jsx`) – gleiches Supabase-Projekt, gleiche Daten.
SQL `23_systemstatus_muenchen.sql`: Anmeldung München (`…+muc@…`) ist ebenfalls Admin; `system_problems()` meldet
zusätzlich den München-Collector (meldet sich nicht > 10 min, FENECON oder Loxone nicht erreichbar);
`system_cloud_status()` liefert `muc` für die Zeile „Heizung München (Collector)“ in beiden Apps.

## 7. Erster Test

- Kopfleiste: Symbol grün? Im Fenster beide PCs mit „meldet sich · vor … s“?
- Harmloser Befehl: **Neustart** von `alexa-bridge` (oder `SmartfoxFronius`) → Zeile zeigt „wird neu gestartet …“,
  nach höchstens etwa 40 s wieder „läuft“. Im Log des Wächters steht `[Befehl] restart …`.
- Mail: in `system_status_websites` vorübergehend eine falsche Adresse eintragen → nach 5–10 min Mail
  „… ist nicht erreichbar“, Eintrag entfernen → Mail „wieder in Ordnung“.

## 8. Offen / später

- Weitere Webseiten aufnehmen (Hausverwaltung, Portale), wenn gewünscht.
- Der Wallbox Manager hat sein eigenes Dienste-Fenster; beide dürfen nebeneinander bestehen.
- Schwellen (10 / 3 / 15 min) sind feste Werte in `system_problems()`; bei Bedarf einstellbar machen.
