# FIX: Blockade der Leistungsgrenze (A, B), Wirkungsprüfung (C), Thermostat-Selbsttest (10.11.2026)

**Auftrag Uli (10.11.2026, 15:24):** „A bis C umsetzen und prüfen, warum wir Probleme haben und mit welchen Thermostaten.“
Danach (15:29): „Eine Routine, die die API-Calls auf jedem einzelnen Thermostat testet.“
**Grundlage:** `doc/PRUEFUNG-REGELN-WECHSELWIRKUNGEN-2026-11-10.md` (Befunde K1–K3)
**Dateien:**
- `supabase/functions/pv-automation/index.ts`
- `supabase/functions/auto-resolve-api-errors/index.ts`
- `supabase/SQL/30_nicht_steuerbar.sql`, `supabase/SQL/31_thermostat_selbsttest.sql`
- `local-collector/tuya-thermostat/thermostat-selbsttest.js`
- `src/components/overview/HouseOverview.tsx`, `src/types/room.ts`

## Diagnose je Thermostat (3 Tage, alle Lesungen)

| Thermostat | Befehle wirken | regelt nach Schaltband | Befund |
|---|---|---|---|
| Kinder Bad | **0 von 808** | ja (heizt nie, weil Soll 19 < Ist) | **nimmt keinen Schreibbefehl an** – Test 15:20: Lesen ok, Schreiben „Timeout set“; Gegenprobe Flur ok; auch App-Änderung kam nicht an |
| Büro | – | – | seit 07.11. 16:48 nicht im Netz (kein Link zum Router) |
| alle übrigen 10 | 85–100 % | ja | ok – „heizt über Soll“ heißt bei ihnen: heizt bis Soll + Band (DP 101), wie gebaut |

- **Heizt nicht, obwohl unter Soll − Band:** 0 Fälle in 3 Tagen, bei allen Geräten. Das Gerätenachtprogramm (DP 111) und die falsche Uhr greifen nachweislich nicht ein.
- **Über Soll + Band + 0,2 °C geheizt:** 0–4 Lesungen je Gerät. Das sind Messrauschen und das 5-Minuten-Raster.
- **Fühlerwahl DP 110 = 3** bei Toilette Eingang und Bad Uli: Daraus folgt kein anderes Regelverhalten. Laut DP-Protokoll steht der Wert seit 01.11. unverändert so. Die Doku „alle 1“ war falsch.
- **Uhrzeit:** Ein Teil der Geräte zeigt die richtige Uhrzeit, der Rest ist um etwa 12 h verschoben (Uli). Für die Steuerung ist das ohne Bedeutung: Modus „home“ (manuell), und das Nachtprogramm wirkt nicht (siehe oben).

**Warum wir Probleme haben:** Es liegt nicht an den Thermostaten (außer Kinder Bad und Büro). Es liegt an der Steuerlogik (K1, K2) und an fehlender Kontrolle, ob Befehle wirken (K3).

## A – Abschalten am Ziel wird nicht mehr ausgehebelt

- **Vorher:** Der alte Übertemperatur-Schutz in der Raumschleife (Ist ≥ Soll + 0,4 und „heizt“) brach **vor** dem Tagesmodus ab. Lag das Soll ≤ Eco, schickte er keinen Befehl. Das Thermostat heizte bis Soll + Band weiter. 271 × in 24 h.
- **Jetzt:** Im **Lokal-Modus** entscheidet bei Räumen mit Tagesmodus-Ziel allein der Tagesmodus, also das Abschalten am Ziel vom 09.11. Unverändert bleiben der Cloud-Modus und Räume mit PV-Budget.
- **Zusätzlich:** Der Eco-Pass (Tagesmodus `grid`) schaltet einen heizenden Raum ab, sobald Ist ≥ Eco + 0,3 °C (`ziel_abschalt_ueber_c`). Vorher setzte er „Eco halten“, und das Thermostat heizte bis Eco + Band.

## B – Allein heizen auch bei reinem Nachlauf

- **Vorher:** Ein Raum größer als die Grenze (Wohnzimmer 5550 W) durfte nur bei `usedW === 0` allein heizen. Nach 60 min Wartezeit reservierte er, und dann wartete jeder andere Raum. Ein einziges nachlaufendes Thermostat (Toilette, 100 W) blockierte so ab 13:00 alle Räume.
- **Jetzt:** Allein heizen ist auch erlaubt, wenn kein Raum Leistung zugeteilt bekommen hat (nur Nachlauf läuft) **und** der Raum die Vorrang-Wartezeit (`cap_wait_boost_min`, 60 min) hinter sich hat. Das gilt für Tag und Nacht, beide nutzen `allocateUnderCap`.

## C – Wirkungsprüfung „nicht steuerbar“

- **SQL 30**, in `thermostat_state_upsert` bei jeder Lesung: Es zählt die ausgeführten `set_temp`-Befehle seit der letzten Sollwert-Änderung am Gerät (max. 24 h, älter als 1 min), deren Wert ≠ dem gemeldeten Soll ist.
  - **≥ 4:** `rooms.nicht_steuerbar_seit` und `_grund` setzen, Fehler `not_controllable` (Banner), Befund „nimmt keine Befehle an“.
  - **0** (Sollwert folgt wieder): Markierung löschen, Fehler schließen, Protokoll „nimmt wieder Befehle an“.
- **`pv-automation`:** Ein markierter Raum fällt aus der Runde, am Tag wie in der Nacht.
  - Er bekommt keine Befehle mehr, außer **einem Prüfbefehl pro Stunde**. Wirkt der, ist der Raum von selbst zurück.
  - Heizt er trotzdem, zählt er zur Leistungsgrenze. Das gilt jetzt auch für „Fühler in der Sonne“ am Tag (vorher nur nachts).
- **`auto-resolve-api-errors`:** Das 24-h-Sicherheitsnetz schließt `not_controllable` nicht mehr. Diesen Fehler schließt SQL 30 selbst.
- **App:** Die Raumkarte zeigt „⚠ Thermostat nimmt keine Befehle an (seit …)“.
- **Offen, im Dienst am Österreich-PC (v1.3, nicht im Repo):** Der Dienst meldet `executed`, ohne dass das Gerät bestätigt hat. C fängt das in der Datenbank ab. Den Dienst selbst korrigieren wir, sobald v1.3 im Repo ist (K8).

## Selbsttest je Thermostat

`node thermostat-selbsttest.js` (Ordner `C:\Users\ulibe\tuya-thermostat`) prüft je Gerät:
1. Port 6668 erreichbar
2. welche Protokollversion antwortet (3.5 / 3.4 / 3.3) und wie schnell
3. welche Datenpunkte das Gerät meldet, im Vergleich zu den anderen
4. Schreiben DP 109 (Ton)
5. Schreiben DP 2 (Soll + 0,5 °C)
6. Schreiben DP 4 + 2 in einem Befehl (wie Dienst v1.3)

Jeder Schreibtest probiert alle Protokollversionen und stellt den Ausgangswert wieder her. Das Ergebnis erscheint in der Konsole und in `thermostat_selbsttest` (SQL 31).
Weitere Aufrufe:
- `node thermostat-selbsttest.js "Kinder Bad"` – nur ein Gerät
- `--nur-lesen` – ohne Schreibtests

## Nebenwirkungen geprüft (Regel 08.11. + Prüfregel 10.11.)

**1. Stelle im Ablauf / wer liest und schreibt dasselbe**

| Änderung | greift wo | davor kann abbrechen | danach überschreibt | dieselben Daten |
|---|---|---|---|---|
| A | Raumschleife Stufe 10 | manuell übersteuert (gewollt) | Stufe 13 Tagesmodus = gewollt | `rooms.target_temp`, Befehle |
| A (Eco) | `allocateDayTargets` Eco-Pass | – | – | wie bisher |
| B | `allocateUnderCap` (Tag + Nacht) | – | – | `cap_wait_state` unverändert |
| C | `thermostat_state_upsert` (Dienst, alle 5 min); `pv-automation` Tag/Nacht | – | – | `rooms.nicht_steuerbar_*` nur von SQL 30; `api_errors` (Dedupe-Trigger: ein offener Eintrag je Gerät) |

**2. Verhalten über Zeit**

| Fall | Ergebnis |
|---|---|
| Nachlauf-Raum hört nach Abschalten auf | nächste Runde `usedW` ohne ihn, normale Zuteilung |
| Nachlauf-Raum hört nie auf (defektes Gerät) | nach 60 min Wartezeit heizt der große Raum trotzdem allein; Grenze kurz um die Nachlauf-Leistung überschritten (heute 100 W) |
| Befehl kurz vor der Lesung | zählt erst ab 1 min Alter → kein Fehlalarm |
| schnell überholte Befehle | Nachrechnung 3 Tage: funktionierende Geräte höchstens 2 → Schwelle 4 |
| Gerät repariert | Prüfbefehl nach ≤ 60 min, wirkt → Markierung weg, Raum wieder normal |
| Gerät bleibt defekt | 1 Befehl/h statt 12/h; Fehler bleibt offen (kein Schließen und Neuanlegen) |

**3. Mit echten Daten nachgerechnet**
- **Lage 10.11. 14:35** (`allocateDayTargets` alt gegen neu, Simulation):
  - alt: 100/4000 W, niemand heizt, 6 Räume warten
  - neu: Wohnzimmer heizt allein (5650 W mit dem 100-W-Nachlauf der Toilette); die Toilette wird abgeschaltet (A)
  - Runde danach: 5550 W, die übrigen Räume warten, bis das Wohnzimmer an der Untergrenze ist (Vorrang vom 09.11.)
- **Eco-Pass:** Flur 21,4 °C, Eco 21, heizt → alt „Eco halten“ (würde bis 22,0 heizen), neu „aus“ (Soll 19,5)
- **Wirkungsprüfung 3 Tage:** Markiert würde nur das Kinder Bad (810 von 810 Prüfpunkten). Alle anderen Geräte kommen auf höchstens 2.
- **Typprüfung `pv-automation`** (deno check): vor und nach der Änderung dieselben 36 alten Meldungen, keine neue. Das Frontend baut fehlerfrei.

**Bewusst so gelassen:**
- **Vorrang vom 09.11.:** Solange das Wohnzimmer allein heizt (laut Raummodell etwa 1–2 h bis 20 °C), warten die übrigen Räume. Dabei sind Zimmer Uli und Zimmer Luis nur 0,2 °C unter ihrer Untergrenze. Ob das so bleiben soll, entscheidet Uli.
- **Räume mit PV-Budget:** Für sie bleibt der alte Übertemperatur-Schutz aktiv. Das betrifft nur Sonnentage mit PV > 500 W.

## Umstellung
1. SQL 30 und 31: **ausgeführt am 10.11.2026** (Supabase-Connector)
2. PR mergen → die GitHub-Aktion deployt `pv-automation` und `auto-resolve-api-errors`, Vercel die App
3. Am Österreich-PC: `git pull`, dann `node thermostat-selbsttest.js` ausführen und die Ausgabe ansehen

## Rückweg
- **PR zurücknehmen (Revert):** Danach laufen die alten Functions wieder.
- **SQL 30 zurücknehmen:** `thermostat_state_upsert` aus SQL 29 bzw. der Fassung vor 10.11. neu einspielen. Die Spalten können bleiben.

## Nachtrag 10.11.2026, 16:05 – Korrektur B2 (Nebenwirkung von B in den Live-Daten)

**Gefunden nach dem Deploy (15:45):**
- **Vorrang verloren:** Das Wohnzimmer bekam um 15:45 die Leistung allein und verlor sie um 15:50 wieder. In der zweiten Runde zählte es nicht mehr als wartend, also griff die Wartezeit-Ausnahme nicht, und der Wirtschaftsraum lief gerade nach (2050 W).
- **„Allein“ unter der Grenze:** Zimmer Uli (2000 W, also *unter* der Grenze) durfte „allein“ heizen, weil es die Wartezeit hinter sich hatte. Mit dem Nachlauf ergab das 4050 von 4000 W.

**B2:** Allein heizen trotz Nachlauf gilt nur noch für einen Raum, der **größer als die Grenze** ist, und nur wenn er **schon heizt** (Vorrang) oder die Wartezeit hinter sich hat. Räume unter der Grenze warten wieder, bis sie hineinpassen.

**Nachgerechnet** (alt B1 / neu B2):

| Fall | B1 (live seit 15:45) | B2 |
|---|---|---|
| 15:50: Wohnzimmer heizt, Wirtschaftsraum läuft nach | Wohnzimmer verliert die Leistung, Haustür heizt (2500 W) | Wohnzimmer heizt weiter (**7600 W**, solange der Wirtschaftsraum nachläuft) |
| 14:35: Toilette 100 W Nachlauf | Wohnzimmer allein (5650 W) | gleich |
| Raum unter der Grenze, 2050 W Nachlauf | Zimmer Uli „allein“ (4050 W) | Zimmer Uli wartet (2050 W) |

**Abwägung, Entscheidung Uli:** Mit B2 behält das Wohnzimmer seinen Vorrang. Die Grenze kann dafür **kurz um die Leistung eines nachlaufenden Raums** überschritten werden (im Fall oben 3,6 kW), bis dieser sein Ziel + 0,3 °C erreicht und abgeschaltet wird.
