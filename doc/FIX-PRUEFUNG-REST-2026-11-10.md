# FIX: Restliche Befunde der Regelprüfung (10.11.2026, abends)

**Auftrag Uli (10.11.2026, 16:06):** „Alle prüfen und am Ende die Korrekturen dokumentieren.“
**Grundlage:**
- `doc/PRUEFUNG-REGELN-WECHSELWIRKUNGEN-2026-11-10.md` (Befunde K1–K8)
- `doc/FIX-REGELN-A-B-C-2026-11-10.md` (A, B, B2, C, Selbsttest – PR #37 und #38, gemergt)

**Dateien:**
- `supabase/functions/pv-automation/index.ts`
- `supabase/SQL/32_lernen_bereinigen.sql`, `supabase/SQL/33_pv_automation_sperre.sql` (beide am 10.11. ausgeführt)

---

## Stand aller Befunde

| # | Befund | Stand |
|---|---|---|
| K1 | alter Übertemperatur-Schutz bricht vor dem Tagesmodus ab | **behoben** (A, live seit 15:45; seitdem kein `[CALL-SKIP]` mehr) |
| K2 | Vorrang-Reservierung + Nachlauf blockieren die Grenze | **behoben** (B/B2; Grenze seit 15:45 wieder mit 2500–4050 W genutzt) |
| K3 | Kinder Bad nimmt keine Befehle an, niemand merkt es | **erkannt und abgefangen** (C, markiert seit 15:38). Das Gerät selbst muss vor Ort geprüft werden. |
| K4 | KI lernt aus Entscheidungen, die nie ausgeführt wurden | **behoben** (siehe unten) |
| K5 | Batterie tagsüber: zwei Festlegungen widersprechen sich | **Entscheidung Uli offen** – Daten unten |
| K6 | Thermostat-Einstellungen uneinheitlich | **geprüft: ohne Wirkung** (Selbsttest + 3 Tage Lesungen); Vereinheitlichen wäre nur Ordnung |
| K7 | drei Aufrufer von `pv-automation` | **behoben** (Lauf-Sperre 60 s, siehe unten) |
| K8 | Dienst v1.3 nicht im Repo; meldet „ausgeführt“ ohne Bestätigung | **offen, Schritt bei Uli** (siehe unten); die Folge fängt C ab |
| K9 | **neu:** wartende Räume heizen noch und zählen nicht zur Grenze | **Entscheidung getroffen** (B2 gemergt = Vorrang behalten), Daten unten |
| L1 | PV-Budget zählt Netzbezug als Sonne | **behoben** (siehe unten) – war belegbar, nicht nur „möglich“ |
| L2 | `calculated_power_w` vor gemessener Leistung | **behoben** (Reihenfolge getauscht; Feld ist heute überall leer, also keine Wirkung) |
| L3 | undefinierte Variable `heatingSettings` (nur Cloud) | **behoben** |
| L4 | Fühler in der Sonne zählt tagsüber nicht zur Grenze | **behoben** (mit C, `_extraUsedW`) |
| – | toter Code | **inventarisiert, nicht entfernt** (siehe unten) |

---

## K4 – KI lernt nur noch aus dem, was wirklich ausgeführt wurde

**Befund:**
- Policies (`learned_policies`) setzen in der Raumschleife früh Aktion und Ziel. Budget-Override und Tagesmodus überschreiben das danach immer.
- Im Lern-Ereignis stand trotzdem `ml_followed = true`.
- Das Kinder Bad lieferte **1774 von etwa 3500 Lern-Ereignissen der letzten 14 Tage**, also die Hälfte von allem, was die KI gelernt hat. Alle wurden als Erfolg bewertet („Ziel erreicht“, weil der Raum ohnehin über dem Absenkziel lag), obwohl kein Befehl wirkte. Daraus entstanden 14 Policies mit bis zu 100 % „Erfolg“.

**Korrektur:**
- **Lern-Ereignis:** neues Feld `entschieden_von` (`tagesmodus` / `budget` / `policy` / `regel`). `ml_followed` ist nur noch `true`, wenn wirklich die Policy das ausgeführte Ziel bestimmt hat.
- Für Räume mit `nicht_steuerbar_seit` (Prüfbefehl) wird kein Lern-Ereignis mehr geschrieben.
- **SQL 32:** 2042 Ereignisse des Kinder Bads (seit 01.10.) aus dem Lernen genommen (`reward = null`, Grund im `outcome`). Dazu 19 noch unbewertete als bewertet markiert und 14 Policies gelöscht. Die Ereignisse selbst bleiben erhalten.

**Hinweis:** Im Lokal-Modus überschreiben Tagesmodus und Budget die Policies immer. Die Policies sind dort heute also wirkungslos (siehe toter Code). Die Korrektur sorgt dafür, dass die Lerndaten stimmen, falls sie wieder genutzt werden, und dass KI-Auswertungen sie nicht falsch lesen.

## K7 – höchstens ein Lauf pro 60 Sekunden

**Befund:** `pv-automation` wird von drei Stellen aufgerufen:
- Cron alle 5 min (`:00`)
- Fronius-Collector (`:00:45`, also 43 s danach)
- Thermostat-Dienst nach jeder Abfrage (`:03`)

Zwei Läufe kurz hintereinander lesen und schreiben `cap_wait_state` und können sich gegenseitig überschreiben. Heute dauert eine Runde 3–5 s, die Läufe haben sich nie überlappt, aber es gibt keinen Schutz.

**Korrektur:** SQL 33 `pv_automation_lauf_starten(60)` setzt atomar den Startzeitpunkt, wenn der letzte Lauf mindestens 60 s her ist. Sonst beendet sich der Lauf sofort mit `skipped`.
- Fehlt die Funktion oder schlägt der Aufruf fehl, läuft die Runde wie bisher (fail-open).
- Getestet: erster Aufruf `true`, zweiter direkt danach `false`.
- **Folge:** Der Fronius-Aufruf 43 s nach dem Cron fällt weg. Statt 3 Läufen pro 5 min sind es 2, um `:00` und um `:03` direkt nach der Thermostat-Abfrage. Weniger doppelte Befehle, keine Überschneidung.

Collector und Dienst am PC bleiben unverändert.

## L1 – PV-Budget zieht den Netzbezug ab

**Befund:**
- Das Eco-Budget im Modus `pv_optimized` (PV > 500 W) war bisher Einspeisung **+ Leistung aller heizenden Räume** + Toleranz.
- Eine Entladung der Batterie wurde abgezogen, **Netzbezug nicht**.
- Ein Raum, der heizt, behielt dadurch sein „PV-Budget“, obwohl der Strom aus dem Netz kam. Räume mit PV-Budget zählen nicht zur Leistungsgrenze des Tagesmodus.

**Beleg:** In 7 Tagen gab es 550 Messungen mit PV > 500 W. Bei **147 davon (27 %)** wurde gleichzeitig Strom aus dem Netz bezogen, im Mittel 1,5 kW. Um genau diese Leistung war das Budget zu hoch.

**Korrektur:** Netzbezug über 50 W wird wie die Batterie-Entladung vom Eco-Budget abgezogen. Im Log steht dann `🔌 Netzbezug-Korrektur`. Ist die Sonne zu schwach, fällt der Raum aus dem PV-Budget in den Tagesmodus und zählt dort zur Grenze. Die tolerante Deaktivierung (300 W bzw. 40 %) dämpft kurze Spitzen wie einen Wasserkocher.

## K9 – Räume, die „warten“, heizen noch (Entscheidung: Vorrang)

**Befund:** Die Grenze rechnet mit zugeteilter Leistung und Nachlauf über dem Ziel. Ein Raum, der den Befehl „warten“ bekommen hat, heizt aber weiter, bis der Befehl beim nächsten Dienst-Durchlauf ankommt. Das dauert bis zu 5 min, bei einem Gerät im Schaltband länger. Seine Leistung fehlt in der Rechnung.

**Beleg** (letzte 24 h, Tagespfad, tatsächlich heizende Räume laut Thermostat):
- 48 von 424 Läufen über 4,5 kW, 9 Läufe über 6 kW, Spitze 7,6 kW
- 09.11., 17:45–18:13: Wohnzimmer allein (5,5 kW) – so gewollt, das Wohnzimmer ist größer als die Grenze
- 10.11., 08:35–09:13: Wohnzimmer + Wirtschaftsraum (7,6 kW), weil der Wirtschaftsraum noch heizte
- 09.11., 10:20–10:40: Laut Grenze waren 3950 W belegt, tatsächlich lagen 8,9–10 kW an. Gleichzeitig entlud die Batterie mit 5,5 kW (SOC 26 → 9 %), und aus dem Netz kamen bis zu 3,75 kW.

**Entscheidung:** Uli hat B2 (PR #38) gemergt. Damit gilt **„Vorrang behalten“**:
- Ein Raum über der Grenze, der heizt, heizt weiter bis zu seinem Ziel.
- Die Grenze kann dabei kurz um die Leistung eines nachlaufenden Raums überschritten werden.

**Alternative, falls gewünscht:** „Grenze streng“. Dann zählen alle Räume, die laut Thermostat heizen, voll zur Grenze, und ein großer Raum heizt erst, wenn sonst wirklich nichts mehr heizt. Das kostet dem großen Raum bis zu 5–10 min pro Wechsel.

## K5 – Batterie tagsüber (Entscheidung Uli offen)

**Die Festlegungen:**
- 27.10. und 01.11.: „Die Batterie ist für die Nacht reserviert“, „Batterie tagsüber nicht verwenden“.
- 02.11. („Wir machen alle 3“): Batterie-Schutz nur an Sonnentagen. An schlechten Tagen gilt „Eco aus jeder Quelle“, also auch aus der Batterie. So ist es umgesetzt.

**Daten** (5-Minuten-Messungen):

| Tag | PV kWh | SOC 8 Uhr | SOC 16:30 | Batterie tagsüber kWh | Netz tagsüber kWh | Netz nachts kWh |
|---|---|---|---|---|---|---|
| 07.11. | 13,9 | 25 % | 66 % | 2,1 | 0,6 | 0,3 |
| 08.11. | 22,6 | 9 % | 75 % | 4,1 | 10,8 | 0,2 |
| 09.11. | 8,7 | 30 % | **7 %** | **7,4** | 5,3 | **17,2** |
| 10.11. | 8,6 | 7 % | – | 2,4 | 7,8 | 17,9 (Nacht davor) |

**Was dafür und was dagegen spricht:**
- Fester Stromtarif, Grundlast praktisch 0 (Uli, 31.10./02.11.). Ob die Batterie tagsüber oder nachts in die Heizung geht, ändert die **Summe aus dem Netz** kaum.
- **Für „tagsüber verwenden“:** Eine leere Batterie kann am nächsten Sonnentag die PV voll aufnehmen. Eine am schlechten Tag geschonte Batterie ist dann schon voll, und mehr PV geht ins Netz.
- **Für „nie tagsüber“:** Nachts steht Batteriestrom zur Verfügung, und der Netzbezug nachts sinkt. Die Summe bleibt ähnlich, aber die Grenze von 4 kW nachts wird weniger oft aus dem Netz gefüllt.

## K8 – Thermostat-Dienst v1.3 ins Repo (Schritt bei Uli)

Am Österreich-PC laufen `C:\Users\ulibe\tuya-thermostat\index.js` (01.11. 11:15) und `tuya-thermostat.js` (01.11. 11:22). Im Repo liegt eine ältere Fassung (v1.1). Solange das so ist, lässt sich der Dienst nicht prüfen oder korrigieren, auch nicht die fehlende Bestätigung („ausgeführt“ ohne Antwort des Geräts).

**Schritt am Österreich-PC (ändert nichts am laufenden Dienst):**
```
Copy-Item C:\Users\ulibe\tuya-thermostat\index.js            C:\Heizung\repo\local-collector\tuya-thermostat\index.js
Copy-Item C:\Users\ulibe\tuya-thermostat\tuya-thermostat.js  C:\Heizung\repo\local-collector\tuya-thermostat\tuya-thermostat.js
cd C:\Heizung\repo
git add local-collector/tuya-thermostat/index.js local-collector/tuya-thermostat/tuya-thermostat.js
git commit -m "Thermostat-Dienst: laufende Fassung v1.3 vom 01.11. ins Repo"
git push
```
`config.json` mit den lokalen Schlüsseln wird **nicht** kopiert.

Danach kann die Bestätigung im Dienst korrigiert werden: Ein Befehl gilt erst als ausgeführt, wenn das Gerät ihn bestätigt hat.

## Toter Code (inventarisiert, nicht entfernt)

Im Lokal-Modus bestimmen Budget-Override (Stufe 12) und Tagesmodus (Stufe 13) jedes Ziel. Was davor Ziele setzt, erzeugt nur Logs und Lern-Ereignisse:

| Stelle in `pv-automation` (Zeile, Stand dieses PR) | warum wirkungslos | Cloud-Bezug |
|---|---|---|
| Harter PV-Gate (≈ 3752) | Ziel wird von Stufe 12/13 überschrieben | nein |
| Learned Policies HIGH/MED/LOW (≈ 3520, 3791) | dito | nein |
| LLM-Entscheidung `analyze-patterns` (≈ 3337) | läuft nur mit Tuya-Cloud-Schlüsseln, die lokal fehlen | **ja**, behalten |
| Fallback + Überschuss-Umleitung (≈ 3882, 3912) | dito wie oben | nein |
| Rotation / Pause (≈ 2647) | ohne `budgeted`, Ziel kommt aus dem Tagesmodus; schreibt aber `last_heating_end` | nein |
| Mikro-Budget (≈ 2842) | zuletzt aktiv am 19.06. | nein |
| Pre-Sync, Quota, PV-Priority, Stop-Reserve | nur Cloud-Modus | **ja**, behalten (Festlegung 26.10.) |

**Vorschlag:** Die Einträge ohne Cloud-Bezug in einem eigenen PR entfernen, mit derselben Prüfung wie hier. Das ist ein eigener Schritt, weil ein Aufräumen von etwa 600 Zeilen selbst wieder Nebenwirkungen haben kann.

---

## Nebenwirkungen geprüft (Regel 08.11. + Prüfregel 10.11.)

| Änderung | Stelle im Ablauf | davor kann abbrechen | danach überschreibt | dieselben Daten | Verhalten über Zeit |
|---|---|---|---|---|---|
| K4 Lern-Ereignis | Stufe 15 (Befehl) | – | – | `learning_events` (nur Feld dazu) | keins |
| K4 SQL 32 | einmalig | – | `update-learned-policies` liest nur `reward is not null` | `learning_events`, `learned_policies` | Kinder-Bad-Policies kommen nicht wieder |
| K7 Lauf-Sperre | vor Stufe 1 | – | – | `system_settings.pv_automation_lauf` (neu) | Ein Lauf, der abbricht, sperrt nur 60 s |
| L1 Netzbezug | Stufe 4 Budget | – | Phase 1/2, Tagesmodus | – | Räume wechseln bei Netzbezug von PV-Budget in den Tagesmodus; Toleranz dämpft |
| L2 Leistung | überall | – | – | `heating_power_w` vor `calculated_power_w` | heute keine Wirkung (Feld leer) |
| L3 | ML-Cache (Cloud) | – | – | – | – |

**Prüfung:** `deno check pv-automation` gibt 35 Meldungen statt vorher 36 (die zu `heatingSettings` ist weg) und keine neuen. SQL 32 und 33 sind ausgeführt und getestet.

## Umstellung
1. SQL 32 und 33: **ausgeführt am 10.11.2026**
2. PR mergen → die GitHub-Aktion deployt `pv-automation`
3. K8-Schritt am Österreich-PC (siehe oben)

## Rückweg
- PR zurücknehmen (Revert)
- SQL 33 kann bleiben; ohne Aufruf ist die Funktion wirkungslos
- SQL 32 ist nicht umkehrbar, die Ereignisse selbst sind aber erhalten
