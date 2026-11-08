# FIX: Alarm-Mails – je Problem genau zwei Mails, mit Lösungsansatz

**Datum:** 8. November 2026
**Supabase:** `pflnniklvqbwjwrjswaz`
**Dateien:** `supabase/SQL/27_alert_mails.sql`, `supabase/functions/system-alert/index.ts`
**Wunsch (Uli):** Eine Mail mit dem Problem und einem Lösungsansatz, eine Mail, wenn es gelöst ist – keine Wiederholungen.

## Befund

Büro-Thermostat seit 07.11. 16:48 nicht erreichbar (letzte echte Lesung in `thermostat_state`). Von 07.11. 17:20 bis
08.11. 06:50 kamen **17 Mails**, im 2-Stunden-Takt abwechselnd „1 offener Gerätefehler“ und „wieder in Ordnung“.
Der Mailtext nannte weder den Raum noch, was zu tun ist.

## Ursache – drei Teile, die einzeln richtig, zusammen falsch waren

1. `system_problems()` (SQL 22) las die Erreichbarkeit aus `api_errors` und zählte einen Fehler erst ab 15 min Alter.
2. `api_errors` wird geschlossen, obwohl das Gerät noch weg ist:
   - `auto-resolve-api-errors` Regel (c): jeder Fehler nach 2 h;
   - `pv-automation` im Lokal-Modus: beim bloßen **Einreihen** eines Befehls (setzt dazu `rooms.last_thermostat_sync = jetzt`) –
     belegt: Büro zuletzt gelesen 16:48, `last_thermostat_sync` aber 19:50;
   - Sicherheitsnetz nach 24 h.
3. Der Dienst legt sofort einen neuen Fehler an → 15 min „kein Problem“ → `system-alert` meldete sofort „wieder in Ordnung“,
   danach wieder „neues Problem“.

## Lösung

**Erreichbarkeit aus der echten Lesung (SQL 27).** `system_problems()` meldet jedes Thermostat einzeln
(`thermo:<room_id>`, „Thermostat Büro nicht erreichbar seit 07.11. 16:48“), wenn `thermostat_state.read_at` älter als 15 min ist.
`read_at` schreibt nur der Thermostat-Dienst bei einer echten Lesung (v1.4, `thermostat_state_upsert`). Läuft der Dienst selbst nicht,
kommt nur „Thermostat-Dienst meldet sich nicht“ – nicht zwölf Einzelmeldungen.

**Übrige `api_errors`** je Quelle + Fehlerart (`err:<quelle>:<art>`), in Worten. Wird ein Fehler geschlossen und innerhalb von
10 min gleich neu angelegt, zählt das als derselbe Fehler.

**Mail (`system-alert`).**
- „Problem“, wenn es seit mind. 4 min besteht – mit Bereich, Text, Zeitpunkt und **Was tun** je Problemart.
- „Gelöst“, wenn es **15 min am Stück** weg ist – mit Dauer. Kommt es in diesen 15 min zurück, ist es dasselbe Problem.
- Keine Erinnerung nach 24 h mehr; offene Probleme zeigt die App.

**Umstellung ohne Fehl-Mail.** SQL 27 schließt den alten Sammel-Schlüssel `cloud:api_errors` still. Danach kommt einmal die
neue Mail zum Büro – mit Lösungsansatz.

## Nebenwirkungen geprüft (Prüfliste, Systemdoku Kopf)

**1. Wer liest/schreibt dieselben Daten?**

| Stelle | betroffen? |
|---|---|
| App Venediger `SystemStatus.tsx`, App München `SystemStatus.jsx` | zeigen `system_problems()` allgemein (key/area/text) – neue Schlüssel und Texte passen |
| `system_cloud_status()` (Fenster) | unverändert |
| `api_errors`, Banner, Protokoll-Trigger, `auto-resolve-api-errors`, `pv-automation` | **unverändert** – SQL 27 liest nur |
| `thermostat_state` | nur gelesen; alle 12 Räume vorhanden, alle 5 min aktualisiert (geprüft 08.11. 07:00) |
| `system_alert_state` | ein Eintrag still geschlossen (`cloud:api_errors`) |
| Heizung München (`muc:*`) | Abschnitt aus SQL 23 unverändert übernommen |

**2. Verhalten über Zeit** (Zustandsautomat nachgebaut, Lauf alle 5 min):

| Verlauf | Mails neu |
|---|---|
| Dauerausfall 14 h | 1 |
| Ausfall 6 h, dann behoben | 2 |
| Ausfall mit 10-min-Lücken alle 2 h (bisheriges Pingpong) | 1 |
| Ausfall mit 20-min-Lücken alle 2 h (Gerät wirklich zurück) | je Phase 2 – gewollt |
| einzelner Aussetzer 5 min | 0 |
| Flackern an/aus 1 h | 2 |

Schwellen, die aufeinandertreffen: Lesung 15 min · Problem 4 min · gelöst 15 min · Dienst-Herzschlag 10 min. Läuft der Dienst
nicht, werden Thermostate nicht einzeln gemeldet.

**3. Echte Daten** (7 Tage `api_errors`, Lücken ≤ 30 min zusammengefasst): neu 3 Problem- + 2 Gelöst-Mails
(Wirtschaftsraum 03.11. und 06.11., Büro seit 07.11.) statt 17 Mails allein seit 07.11. 17:20.
Übrige Fehlerarten: `no_control_channel` zweimal > 20 min (echte Ausfälle des lokalen Dienstes) → je 2 Mails.

**Bewusst nicht geändert (eigene Aufgabe, siehe TODO):** `pv-automation` meldet im Lokal-Modus „erreichbar“ ohne Antwort. Das
betrifft die Heizlogik (Phase 2 wartet evtl. auf einen toten Raum, Sicherheits-Resync) und den Fehler-Banner – dafür erst
Konzept, dann Änderung.

## Einspielen

1. `supabase/functions/system-alert/index.ts` hochladen → GitHub-Aktion deployt (oder `supabase functions deploy system-alert`).
2. **Danach** SQL 27 ausführen. Prüfen: `select * from jsonb_array_elements(public.system_problems());`
3. Erwartet: in ≤ 10 min eine Mail „Problem: Thermostat Büro nicht erreichbar …“ mit Lösungsansatz; keine „gelöst“-Mail.

Rückweg: `system_problems()` aus SQL 22 + 23, alte `system-alert` aus der Git-Historie.
