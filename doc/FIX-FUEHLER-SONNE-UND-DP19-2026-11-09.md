# Fix: Sonne auf dem Fühler und Temperatur-Korrektur DP 19 (09.11.2026)

**Status:** von Uli beauftragt 09.11.2026 („Option 2“, „Ja“) · SQL 28 ausgeführt 09.11. 18:28 · PR #32
**Betrifft:** SQL `28_fuehler_plausibel.sql` (Trigger auf `rooms`, `capture_room_temperature_sample`, Altdaten),
`supabase/functions/pv-automation/index.ts`, App: `HouseOverview.tsx` (Raumkarte), `HouseSettingsCard.tsx`
(Einstellungen › Haus › Thermostat-Fühler), Typen.

## Anlass
09.11.2026, Wohnzimmer kalt (19,5–20 °C), Uli: „32 °C kann nicht sein.“ Die Tagesanalyse hatte das Wohnzimmer an
den Vortagen als warm gesehen (06.11. bis 32,4 °C, 07./08.11. morgens 21,6/21,7 °C).

## Befund 1: Sonne auf dem Fühler (nur Wohnzimmer, Süd)
Gesucht über alle Räume, 16 Tage: Anstieg ≥ 1,5 °C in 30 min ohne Heizen. Treffer nur im Wohnzimmer, nur an
sonnigen Vormittagen:

| Tag | Sprung | gemeldet | danach | Dauer | PV |
|---|---|---|---|---|---|
| 26.10. | 08:15 → 08:30 | 20,3 → 27,1 °C | 21,6 °C | ~1 h | 5,8 kW |
| 31.10. | 09:19 → 09:34 | 18,9 → 24,4 °C | 20,2 °C | ~40 min | 8,4 kW |
| 06.11. | 09:08 → 10:28 | 21,3 → 32,4 °C | 23,4 °C (fällt weiter) | ~2 h | 8,3 kW |

Bis zu 3,7 °C in 5 min und ebenso schneller Abfall – ein 65-m²-Raum kann das nicht. Das Thermostat bekommt direkte
Sonne; das Fenster wandert mit dem Wintersonnenstand nach hinten und wird länger. Abschatten ist laut Uli kaum möglich.

**Folgen bisher:** Automatik, Planer, Raummodell, Tagesanalyse und Tagesnote nahmen 25–32 °C als Raumtemperatur
(z. B. `comfort_saturated_at` 06.11. 10:28 = Estrich „voll“ mitten in der Spitze; KI sah das Wohnzimmer als warm).
Das Thermostat selbst heizt in dieser Zeit ohnehin nicht – es misst am heißen Fühler.

## Befund 2: DP 19 verschiebt die gemeldete Temperatur doch
Am 06.11. 20:04 wurde DP 19 an allen Geräten von −10 (−1,0 °C) auf 0 gesetzt (Büro am 01.11. 17:52). In der
**übernächsten** Lesung (4–9 min später) springt die gemeldete Temperatur in jedem dieser Räume um +0,7 bis +1,0 °C:

| Raum | vorher | nachher | Raum | vorher | nachher |
|---|---|---|---|---|---|
| Zimmer Uli | 21,4 | 22,4 | Haustür | 21,2 | 22,2 |
| Zimmer Luis | 20,4 | 21,4 | Flur | 21,4 | 22,4 |
| Zimmer Luca | 21,3 | 22,3 | Waschraum | 20,0 | 21,0 |
| Wohnzimmer | 22,4 | 23,4 | Toilette Eingang | 20,8 | 21,6 |
| Büro (01.11.) | 19,4 | 20,3 | Wirtschaftsraum, Bad Uli | +0,7/+0,8 | |

Die Annahme vom 01.11. („DP 19 verschiebt die gemeldete Temperatur nicht“, `THERMOSTAT-DATENPUNKTE.md`) war falsch:
gelesen wurde damals direkt nach dem Befehl, der Sprung kam erst in der nächsten Lesung (17:57).
**Folgen:**
- Alle Werte vor der Umstellung liegen 1 °C zu tief. Tagesanalyse (7 Tage), Raummodell und Planer (14 Tage)
  vergleichen gerade beide Stände.
- Seit dem 06.11. zeigen die Thermostate 1 °C mehr als vorher bei gleicher Raumluft. Die Steuerung hält die
  eingestellten Werte seitdem als echte Temperatur; vorher lag der Raum bei gleichem Sollwert ~1 °C wärmer, als
  angezeigt. Die Räume fühlen sich seit dem 06.11. bei gleichen Einstellungen kühler an.
- **Kinder Bad:** DP 19 steht noch auf −10, obwohl beide Befehle (20:04, 20:10) als „ausgeführt“ gemeldet sind.
  Der Dienst prüft `set_dp` nicht nach. Kinder Bad meldet also weiter 1 °C zu wenig (auch die genehmigte
  Untergrenze 21 °C vom 08.11. beruht darauf). → TODO, nicht Teil dieses Fixes.

## Lösung

### A) Plausible Raumtemperatur (Trigger `a_trg_fuehler_plausibel`, BEFORE UPDATE OF current_temp ON rooms)
- `rooms.current_temp_gemeldet` = Gerätewert, `rooms.current_temp` = plausibler Wert. Alle Leser (Steuerung, Planer,
  KI, Tagesnote, App) bekommen dadurch ohne eigene Änderung den richtigen Wert.
- **Start:** Sprung ≥ `fuehler_sprung_c` (2,0 °C) zur letzten Lesung **oder** ≥ `fuehler_sprung15_c` (3,0 °C) über
  den kleinsten Wert der letzten 15 min. Kein Start nach einer Lesepause > 15 min (Gerät war offline).
- **Halten:** letzter plausibler Wert (`fuehler_sonne_ref`), `fuehler_sonne_seit` gesetzt.
- **Ende:** gemeldeter Wert ≥ `fuehler_ende_abstand_c` (1,5 °C) unter der Spitze und 10 min ruhig (≤ 0,3 °C je
  Lesung) – dann gilt der gemeldete Wert wieder. Spätestens nach `fuehler_max_stunden` (3 h).
- Nur echte Lesungen zählen (`last_thermostat_sync` ändert sich) – andere Schreiber ändern den Zustand nicht.
- Protokoll: „Fühler in der Sonne: gemeldet …, gerechnet …“ und „Fühler wieder plausibel …“ (Art `thermostat`).
- Alle Grenzen in Einstellungen › Haus › Thermostat-Fühler, abschaltbar.

### B) Messwerte
`room_temperature_samples.temperature` = plausibler Wert; `temperature_gemeldet` = Gerätewert, wenn abweichend;
`fuehler_sonne` = gehalten; `korrektur_dp19` = nachträgliche Korrektur.

### C) Altdaten (einmalig, wiederholbar, umkehrbar)
1. DP 19: Messwerte je Raum vor dem gemessenen Sprung +1,0 °C (Tabelle `fuehler_korrektur`, Zeitpunkte aus den
   Daten). Kinder Bad nicht (Gerät noch auf −1,0). Rückweg im Skript.
2. Sonnen-Prüfung rückwirkend über 16 Tage mit derselben Logik (`fuehler_nachpruefen`).

### D) `pv-automation`
- Tag: Räume mit `fuehler_sonne_seit` werden vor der Verteilung herausgenommen – kein PV-Budget, kein Anteil an der
  Leistungsgrenze, kein Befehl. Sie zählen als „nicht auf Komfort“ (kein Super-Komfort für die anderen).
- Nacht: wie manuell übersteuert (keine Befehle, zählt mit, wenn er heizt).
- Nacht-Raumliste mit `select('*')`, damit sie auch ohne die neue Spalte läuft.

### E) App
Raumkarte: „☀ Fühler in der Sonne seit … – gemeldet …, gerechnet …“. Ist zeigt den gerechneten Wert.

## Nachgerechnet (09.11.2026, Testlauf im Rollback gegen die echte Datenbank)
- Start-Bedingung über 16 Tage, alle 12 Räume: nur die drei Wohnzimmer-Morgen lösen aus. Größter andere Sprung
  1,4 °C (Haustür beim Heizen, 05.11. 17:58), DP-19-Sprung 1,0 °C.
- Rückwirkend: Wohnzimmer 3 Spitzen, 58 Werte gehalten, alle anderen Räume 0; zweiter Lauf gleiches Ergebnis.

| Tag | gehalten | gerechnet (inkl. DP 19 +1,0) | Ende: gemeldet übernommen (vor DP-19-Korrektur) |
|---|---|---|---|
| 26.10. | 08:20–09:19 | 21,3 °C | 09:24 · 21,6 °C |
| 31.10. | 09:24–09:59 | 19,8 °C | 10:00 · 20,4 °C |
| 06.11. | 09:13–11:23 | 22,2 °C | 11:25 · 23,4 °C |

- Trigger mit Testwerten: 19,5 → 22,5 (Start, 19,5 gehalten) → 26 → 24 → 23,9 → 23,8 → 23,8 (Ende nach 10 min
  ruhig, 23,8 übernommen). Nach 75 min Lesepause 27,0 → kein Start.
- DP 19: 11 Räume, zusammen ~37.600 Messwerte +1,0 °C.

## Nebenwirkungen geprüft

**1. Wer liest/schreibt dieselben Daten?**

| Stelle | nach der Änderung |
|---|---|
| Thermostat-Dienst (`collector-node`) | schreibt `current_temp` (Gerätewert) + `last_thermostat_sync` je Lesung – unverändert; der Trigger macht daraus den plausiblen Wert |
| `tuya-control` (Cloud-Modus) | schreibt `current_temp` teils ohne `last_thermostat_sync` → dort keine Prüfung (Cloud-Modus nicht aktiv; TODO) |
| App `saveRoom` (ganze Zeile) | nur beim Anlegen eines Raums benutzt; ändert `last_thermostat_sync` nicht → Trigger lässt alles unverändert |
| `thermostat_state` (`ist`, Befund „heizt über Soll“) | bleibt Gerätewert – richtig, das Gerät regelt danach |
| `capture_room_temperature_sample` | speichert plausiblen Wert + Gerätewert |
| `log_room_heating_transition`, `trg_protokoll_raum` | unverändert; Heizzyklus-Starttemperatur ist der plausible Wert |
| `protect_rooms_sensitive_columns` | betrifft die neuen Spalten nicht |
| Lernen: `ki_raum_tag`, Raummodell (SQL 18), Heizplaner (SQL 25), Tagesnote (14/16/17), Nacht-Protokoll (10), Leistungsmessung (24), Batterie-Schutz-Protokoll (12) | lesen `room_temperature_samples.temperature` → plausibel und DP-19-korrigiert. Bereits gespeicherte Tagesnoten/Raummodelle der Vortage bleiben; Raummodell und Planer lernen nachts neu |
| `room_heating_logs` (Dienst A2) | Gerätewert, nicht korrigiert (nur Protokoll) |
| `pv-automation` Übertemperatur, Komfort-Sättigung (`comfort_saturated_at`), Stufe 4 | Raum mit Sonnenspitze ausgelassen → keine Fehlauslösung |
| App: Analyse (`dayAnalysis`), Solar-Chart | lesen Samples → plausibel |

**2. Verhalten über Zeit**

| Verlauf | Ergebnis |
|---|---|
| Sonnenspitze 30 min – 2 h | Wert gehalten, Raum aus der Verteilung, Ende nach 10 min ruhig |
| Raum wird durch Sonne wirklich wärmer | Ende übernimmt den neuen, höheren Wert (26.10.: 21,6 statt 20,3 °C) |
| Spitze länger als 3 h / Fühler hängt hoch | Zeitgrenze: gemeldeter Wert gilt wieder, Protokoll „Zeitgrenze erreicht“ |
| Gerät war offline und kommt mit anderem Wert zurück | kein Start (Lesepause > 15 min) |
| Kamin heizt schnell | gemessen ≤ 1,0 °C je Lesung → kein Start |
| Kinder Bad DP 19 wird später auf 0 gestellt | +1,0 °C → unter der Schwelle, kein Start; Altdaten Kinder Bad dann nachkorrigieren |
| Spitze beginnt, während der Raum heizt (26.10. 08:15) | Leistung zählt für einen Lauf nicht zur Grenze; Thermostat schaltet am heißen Fühler sofort ab |
| Dienst-Neustart, doppelte Lesungen | doppelte Lesung = gleicher Wert → kein Start, „ruhig“ nach Zeit, nicht nach Anzahl |

**3. Echte Daten:** siehe „Nachgerechnet“.

**4. Umstellung:** SQL 28 zuerst (Spalten, Trigger, Altdaten), dann PR mergen (pv-automation über GitHub-Aktion,
App über Vercel). Läuft pv-automation vor SQL 28 neu, fehlt nur die Spalte → Tag: keine Räume ausgelassen,
Nacht: `select('*')` ohne Fehler.

**Bewusst nicht geändert**
- Kinder Bad DP 19 (Gerät) und `set_dp` ohne Nachprüfung im Dienst – TODO.
- Fehler beim Vorrang (Raum über der Grenze verliert nach einem Lauf das „allein heizen“) – eigener Fix als Nächstes.
- `room_heating_logs.current_temp` nicht korrigiert.

## Rückweg
- Trigger: Einstellungen › Haus › Thermostat-Fühler „Sonne auf dem Fühler erkennen“ aus.
- Altdaten DP 19: Rückweg-Abfrage im Skript (Teil C1).
- PR rückgängig machen (Revert).
