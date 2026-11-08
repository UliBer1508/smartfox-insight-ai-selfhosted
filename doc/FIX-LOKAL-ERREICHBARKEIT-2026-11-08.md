# FIX: Lokal-Modus – „erreichbar“ nur nach echter Lesung

**Datum:** 8. November 2026
**Supabase:** `pflnniklvqbwjwrjswaz` · Steuermodus: **local**
**Dateien:** `supabase/functions/pv-automation/index.ts`, `supabase/functions/auto-resolve-api-errors/index.ts`,
`src/hooks/useApiErrors.ts` – kein SQL
**Anlass:** Bei der Mail-Flut (`FIX-ALERT-MAILS-2026-11-08.md`) gefunden.

## Befund

Im Lokal-Modus heißt „erfolgreich“ in `pv-automation` nur: Befehl in `thermostat_commands` eingereiht. Trotzdem hat
`pv-automation` danach so getan, als hätte das Thermostat geantwortet:

| Stelle in `pv-automation` | schrieb | Folge |
|---|---|---|
| Heizen an/aus (Stufe 2/3, 3b) | `last_thermostat_sync = jetzt`, schloss **alle** offenen Fehler des Raums | toter Raum galt als erreichbar; Offline-Fehler geschlossen, Dienst legte sie neu an |
| Nacht halten / Frostschutz | `last_thermostat_sync = jetzt` (Frost auch `is_heating = false`) | wie oben; Heizzyklus-Trigger mit erfundener Zeit |
| Über-Temperatur (mit/ohne Befehl) | `is_heating = false` (mit Befehl auch Sync-Zeit) | gemessene Heizt-Meldung (DP 5) überschrieben → Trigger 04 schreibt falschen Stopp, nächste Lesung falschen Start |

**Beleg:** Büro zuletzt gelesen 07.11. 16:48 (`thermostat_state.read_at`), `rooms.last_thermostat_sync` aber 19:50.

Dazu `auto-resolve-api-errors`: Regel (b) „wieder erreichbar“ las genau diesen Zeitstempel, Regel (c) schloss jeden
Gerätefehler nach 2 h, das Sicherheitsnetz nach 24 h, Regel (a) auch mit einem Befehl von **vor** dem Ausfall.
Die App blendete Offline-Fehler nach 2 h zusätzlich aus. Ergebnis: Ein Gerät, das seit Stunden fehlt, erschien als
alle 2 h „neu“ und dazwischen „behoben“.

## Lösung

**pv-automation (nur Lokal-Modus, Cloud unverändert)**
- schreibt nach dem Einreihen kein `last_thermostat_sync` und kein `is_heating` mehr – das schreibt allein der
  Thermostat-Dienst nach einer echten Lesung (alle 5 min);
- schließt bei „Erfolg“ keine `device_offline`/`connection_error` mehr (andere Fehler des Raums wie bisher);
- Sicherheits-Resync (Sync > 60 min bei wenig PV) nur noch im Cloud-Modus. Lokal liest der Dienst ohnehin alle 5 min,
  und Stufe 4 korrigiert Abweichungen; ein alter Zeitstempel heißt lokal „Gerät antwortet nicht“ – ein weiterer
  Befehl hilft nicht und erzeugte nur ein Lern-Ereignis je Lauf.

**auto-resolve-api-errors**
- (a) ausgeführter Befehl zählt nur, wenn er **nach** dem Fehler ausgeführt wurde;
- (b) „wieder erreichbar“ aus `thermostat_state.read_at` (echte Lesung) statt `last_thermostat_sync`;
- (c) 2-h-Regel nur noch für Fehler ohne bekanntes Gerät;
- Sicherheitsnetz 24 h: nicht für Erreichbarkeits-Fehler eines bekannten Geräts.
→ Ein Ausfall ist **ein** offener Fehler vom ersten Aussetzer bis zur ersten echten Lesung.

**App (`useApiErrors`)**: Offline-Fehler werden nicht mehr nach 2 h ausgeblendet. Der Filter gegen einmalige Aussetzer
(< 3 min und < 3 Einträge) bleibt.

## Nebenwirkungen geprüft

**1. Wer liest/schreibt dieselben Daten?**

| Stelle | nach der Änderung |
|---|---|
| Thermostat-Dienst (`collector-node`) | schreibt `current_temp`, `target_temp`, `is_heating`, `last_thermostat_sync` und `thermostat_state` je echter Lesung – unverändert, jetzt einzige Quelle |
| `pv-automation` `isRoomStale` (> 2 h) | greift jetzt für tote Räume → sie blockieren Phase 2 (Komfort) nicht mehr (so in §4 gedacht) |
| `pv-automation` `syncStale` / Resync | erreichbare Räume: Dienst stempelt alle 5 min → greift wie bisher nie; tote Räume: kein Resync mehr |
| `pv-automation` Stufe 4 (`tempAlreadyCorrect`) | unverändert – `target_temp` wird weiter geschrieben |
| Heizzyklen-Trigger 04 (`coalesce(new.last_thermostat_sync, now())`) | Wechsel von `is_heating` kommen lokal nur noch vom Dienst, mit echter Zeit |
| `auto-resolve-api-errors` (1) Herzschlag-Fehler | unverändert |
| Dedupe-Trigger 05, Protokoll-Trigger 11 | ein Eintrag je Ausfall statt alle 2 h |
| `system_problems()` (SQL 27) | liest `thermostat_state`, nicht `api_errors` – Mails unberührt |
| App: Raumkarte „Messung … vor X min“ | zeigt für tote Räume jetzt die echte Zeit |
| App: `useActiveHeatingRooms` Sync-Alter | wirft das älteste 10 % weg → ein toter Raum färbt die Anzeige nicht |
| App: Fehler-Banner | zeigt einen Ausfall dauerhaft, bis das Gerät gelesen wird (gewollt) |
| Cloud-Modus | alle Änderungen an `controlMode === 'cloud'` gebunden bzw. nur für Lokal wirksam |

**2. Verhalten über Zeit**

| Verlauf | vorher | nachher |
|---|---|---|
| Thermostat 14 h tot | Fehler alle 2 h neu, „behoben“ dazwischen; nach 2 h nie „stale“ | ein offener Fehler; nach 2 h stale → kein Phase-2-Block |
| kurzer Aussetzer (1 Lesung) | Fehler, nach ≤ 10 min geschlossen | gleich |
| Gerät fällt kurz nach erfolgreichem Befehl aus | Fehler 30 min lang alle 5 min geschlossen und neu | bleibt offen |
| Über-Temperatur lokal | `is_heating=false` geschrieben, nächste Lesung wieder `true` → Schein-Zyklus | nur Befehl; Zyklus endet, wenn das Gerät wirklich aufhört |
| Dienst SmartfoxTuya gestoppt | alle Räume nach 1 h Resync-Befehle | Befehle bleiben eingereiht; Systemstatus meldet den Dienst |

**3. Echte Daten (7 Tage)**: Steuermodus `local`; Sicherheits-Resync-Lernereignisse 4; Über-Temperatur-Befehle 0;
Frostschutz-Befehle 24 (vor Umstellung auf „Nachtwert halten“); offene Gerätefehler heute: nur Büro (bleibt offen bis
zur ersten Lesung). Repo-Stand von `auto-resolve-api-errors` = deployter Stand (v15) – Deploy bringt nur diese Änderung.

**4. Umstellung**: kein SQL, keine Reihenfolge nötig. Nach dem Deploy bleibt der Büro-Fehler offen; der Banner zeigt
„Büro offline“ dauerhaft, bis das Gerät wieder antwortet.

**Bewusst nicht geändert**
- Ein toter Raum behält seine letzten Messwerte (`current_temp`, `is_heating`) und geht damit weiter in die Verteilung
  der Leistungsgrenze ein. Heizt ein totes Thermostat mit Strom weiter, ist das die vorsichtige Annahme. Eigener Punkt
  im TODO.
- 65 % der Heizzyklen der letzten 7 Tage sind < 6 min (256 von 391). Ob echtes Takten oder Abtast-Effekt (Lesung alle
  5 min), ist offen – eigener Punkt im TODO, nicht Teil dieses Fixes.

## Rückweg
PR rückgängig machen (Revert) → GitHub-Aktion deployt die alten Functions, Vercel die alte App.
