# Prüfung: alle Regeln und Prozesse, die sich gegenseitig beeinflussen (10.11.2026)

**Anlass:** Am 10.11. warteten ab 13:00 sechs Räume unter ihrer Untergrenze. Von der Grenze (4000 W) waren dabei nur 100 W belegt.
Uli: „Warum werden die Regeln nicht vor jeder Änderung geprüft, ob sie sich beeinflussen? Das hatten wir festgelegt.“
**Umfang:**
- `pv-automation` vollständig gelesen (4483 Zeilen)
- alle 28 Edge Functions, 30 Cron-Jobs, Trigger auf `rooms`, `thermostat_commands`, `heating_settings` und `api_errors`
- der Thermostat-Dienst
- Belege aus Logs und Datenbank (letzte 24 h bzw. 3–10 Tage)

**Code-Änderungen:** keine. Dieses Dokument ist nur der Befund mit Vorschlägen.

---

## 1. Warum das immer wieder passiert

1. **Geprüft wurde nur die geänderte Stelle.** Am 09.11. (Vorrang, Abschalten am Ziel) wurden `allocateDayTargets` und die Nachtlogik geprüft. Nicht geprüft wurden die Stufen, die in der Raumschleife **vorher** laufen und mit `continue` abbrechen. Die neue Logik wird dann gar nicht mehr erreicht (Befund K1).
2. **`pv-automation` besteht aus Schichten.** Aus der Lovable-Zeit sind noch ML-Policies, LLM-Entscheidung, Mikro-Budget, Rotation, harter PV-Gate und der Übertemperatur-Schutz aktiv. Darüber liegen PV-Budget (Phase 1/2), Tagesmodus, Leistungsgrenze, Vorrang und Schaltband.
   - Normalerweise gewinnt die **letzte** Stufe, der Tagesmodus. Die alten Stufen sind dann nur Ballast.
   - Gefährlich sind die Stufen, die **vorher abbrechen** oder **Daten schreiben, die spätere Stufen lesen**.
3. **„Befehl ausgeführt“ heißt nicht „Befehl wirkt“.** Der Dienst meldet `executed`, sobald das Gerät den Befehl angenommen hat. Ob sich der Sollwert danach wirklich ändert, prüft niemand (Befund K3).
4. **Der laufende Code ist nicht der Code im Repo.** `tuya-thermostat.js` läuft am Österreich-PC in v1.3, im Repo liegt v1.1. Eine Prüfung gegen das Repo bleibt deshalb unvollständig (Befund K8).

---

## 2. Ablauf einer Runde in `pv-automation` (Tag, Lokal-Modus)

Die Reihenfolge entscheidet. **Fett** markiert sind die Stufen, die abbrechen oder Ziel bzw. Befehl festlegen.

| # | Stufe (Zeile) | Wirkung |
|---|---|---|
| 1 | Steuermodus, Quota (679–892) | lokal: Quota spielt keine Rolle |
| 2 | **Nacht (993–1405)** | eigener Pfad mit Leistungsgrenze, Vorrang und Abschalten am Ziel; endet mit `return`. Hier gibt es **keinen** Übertemperatur-Schutz. |
| 3 | Fühler in der Sonne (1506) | betroffene Räume fallen ganz aus der Runde |
| 4 | Budget PV (1914–2196) | Eco-/Komfort-Budget aus Export **+ Leistung aller gerade heizenden Räume** |
| 5 | Tagesart, SOC-Gate (2198–2325) | Sonnentag ja/nein; bei Sonnentag und SOC unter dem Gate: Notfall-Stopps (eigene Befehle) |
| 6 | Pre-Heat, Weekly, Pattern-Recall (2327–2414) | heben das Budget an |
| 7 | Phase 1 / 1b / Mikro / Phase 2 / Sättigung (2577–3144) | `roomBudgetStatus`; nur Räume mit `budgeted` haben echtes PV-Budget |
| 8 | **Tagesmodus (3146–3237)** | `allocateDayTargets`: Untergrenze, Leistungsgrenze, Vorrang, Schaltband – für alle Räume ohne PV-Budget |
| 9 | Raumschleife: manuell übersteuert → `continue` | |
| 10 | **Übertemperatur-Schutz (3545–3626)** | Ist ≥ Soll + 0,4 und „heizt“: Liegt das Soll ≤ Eco, gibt es **keinen Befehl**, dann `continue`. Liegt das Soll über Eco, kommt der Befehl „auf Eco“, dann `continue`. **Stufe 12 wird übersprungen.** |
| 11 | Nacht-Check, harter PV-Gate, Policies, LLM, Fallback (3656–3855) | setzt `action` und `targetTemp` – wird von 12 bzw. 13 überschrieben |
| 12 | Budget-Override (3861–3973) | für Räume mit Budget-Status |
| 13 | **Tagesmodus-Ziel (3975–3989)** | überschreibt Ziel und Aktion für Räume ohne PV-Budget |
| 14 | Deckel, Hardguard, Cooldown, Skip (3991–4115) | |
| 15 | Befehl in `thermostat_commands`, `rooms.target_temp` schreiben | |

---

## 3. Wer schreibt dieselben Daten

| Daten | Schreiber | Leser |
|---|---|---|
| `rooms.target_temp` | `pv-automation` (nach jedem Einreihen); **Thermostat-Dienst** (alle 5 min, Gerätewert DP 2); App (manuell) | `pv-automation` (Skip, Übertemperatur, Nacht), App, Protokoll-Trigger |
| `rooms.is_heating`, `current_temp` | allein der Thermostat-Dienst (seit 08.11.); Trigger `a_trg_fuehler_plausibel` rechnet `current_temp` um | `pv-automation` (Nachlauf, Budget), Heizzyklen-Trigger |
| `thermostat_commands` | `pv-automation`, App, SOC-Gate-Stopps, Mikro-Ende | Thermostat-Dienst; Cron `expire-stale` (nach 2 h) |
| `system_settings.cap_wait_state` | `pv-automation` Tag **und** Nacht (lesen, ändern, schreiben) | `pv-automation` |
| `heating_settings` | App; `battery-soc-decision` (nur nach Genehmigung); `ai-parameter-advisor` (Auto-Apply technisch möglich, aber Whitelist nur `shadow`/`suggest`, in 14 Tagen 0 automatische Änderungen) | alle |
| `rooms.calculated_power_w` | `calculate-heating-power` (kein Cron, heute überall leer) | `pv-automation` (**geht vor** `heating_power_w`) |
| Aufruf von `pv-automation` | Cron alle 5 min (`/check`), Thermostat-Dienst nach jeder Abfrage, Fronius-Collector alle 2 min | – |

Die Leistungsmessung, `ki-tagesanalyse`, `heizplaner` (Schattenbetrieb) und `analyze-patterns` schreiben nur eigene Tabellen oder Vorschläge. Mit der Steuerung kollidieren sie nicht.

---

## 4. Befunde – nach Wirkung sortiert

### K1 – Alter Übertemperatur-Schutz blockiert das Abschalten vom 09.11. (hoch)
- **Was:** Stufe 10 läuft vor dem Tagesmodus. Liegt das Soll schon auf Eco oder darunter, nimmt sie an, „das Thermostat hört von selbst auf“. Sie schickt dann keinen Befehl und bricht ab. Die Regel vom 09.11. („Ziel + 0,3 erreicht → Thermostat aus, sonst heizt es bis Ziel + Band“) kommt nie zum Zug.
- **Beleg:** In 24 h 271 × `[CALL-SKIP]` bei 7 Räumen. Toilette Eingang 152 ×, Bad Uli 41 ×, Wohnzimmer 27 ×, Wirtschaftsraum 18 ×, Zimmer Luis 17 ×, Zimmer Uli 14 ×, Flur 2 ×. Die Toilette meldet seit über 24 h „heizt“ bei 21,8 °C und Soll 21 °C.
- **Folge:** Thermostate heizen bis Soll + Band (DP 101) weiter, statt am Ziel abgeschaltet zu werden. Die Räume zählen als Nachlauf zur Leistungsgrenze und lösen K2 aus.
- **Nachtrag 10.11.:** Das Weiterheizen bis Soll + Band ist das normale Verhalten aller Geräte (Auswertung 3 Tage), kein Gerätefehler. Fehler war nur, dass die Abschaltung nicht ankam. Umgesetzt in `doc/FIX-REGELN-A-B-C-2026-11-10.md`.

### K2 – Vorrang-Reservierung plus Nachlauf: Kein Raum heizt mehr (hoch)
- **Was:** Das Wohnzimmer (5550 W, mehr als die Grenze von 4000 W) wartet seit 11:30. Nach 60 min **reserviert** es: Alle anderen warten, bis es „allein“ heizen kann. „Allein“ verlangt aber `usedW === 0` (Zeile 212). Die nachlaufende Toilette (100 W, wegen K1) macht `usedW` nie 0.
- **Beleg:** Tagesmodus ab 13:00 durchgehend „Netz 100/4000 W“, zuletzt geprüft um 14:48. Kinder Bad, Zimmer Uli, Zimmer Luis, Wirtschaftsraum, Haustür und Wohnzimmer liegen unter ihrer Untergrenze und „warten“.
- **Folge:** Die Untergrenze wird nicht gehalten, obwohl 3,9 kW frei sind. Nachts kann das genauso passieren, denn die Nachtlogik nutzt dieselbe `allocateUnderCap`. Dort schaltet aber das Abschalten am Ziel den Nachlauf ab, weil es in der Nacht keinen Übertemperatur-Schutz gibt.

### K3 – Kinder Bad nimmt keinen Befehl an, und niemand merkt es (hoch)
- **Beleg:**
  - In 3 Tagen 808 Befehle (18–21 °C), alle `executed`, **bei keinem** hat sich DP 2 geändert.
  - Im DP-Protokoll gibt es seit seinem Start am 01.11. **keine einzige** Änderung am Kinder Bad. Auch DP 19 ist noch −1,0, obwohl am 06.11. alle auf 0 gesetzt wurden.
  - Seit dem 01.11. sind es 1727 Befehle.
  - Zum Vergleich die anderen Räume: 85–100 % der Befehle wirken.
- **Folge:**
  - Das Kinder Bad steht fest auf 19 °C (Untergrenze 21 °C).
  - Es bekommt jede Runde einen neuen Befehl. Das liegt daran, dass `pv-automation` `target_temp` = Befehl schreibt und der Dienst wieder den Gerätewert schreibt.
  - In der Leistungsgrenze zählt es als steuerbarer Raum.
- **Ursache geklärt (Test am 10.11.2026, 15:20):** Es liegt am Gerät.
  - `node set-dp-test.js "Kinder Bad" 109 false`: Verbindung über v3.5 klappt, Lesen klappt, Schreiben endet mit **„Timeout 4000ms: set“**. Das Gerät bestätigt den Schreibbefehl nicht.
  - Gegenprobe Flur, derselbe Befehl: VORHER `true`, NACHHER `false`. Skript und Protokoll funktionieren.
  - Auch eine Änderung auf 20 °C aus der Tuya-App kam nicht an (DP 2 blieb 190).
  - Lösung vor Ort: Strom aus und wieder ein (Sicherung); hilft das nicht, das Gerät tauschen. Bitte keinen Werksreset.
- **Zweiter Fehler, im Dienst:** Der Thermostat-Dienst (v1.3 am Österreich-PC) meldet `executed` bzw. „[OK] gesetzt“, obwohl das Gerät den Befehl nie bestätigt hat. Ein Befehl darf erst als ausgeführt gelten, wenn das Gerät ihn bestätigt und die nächste Lesung den neuen Wert zeigt (Vorschlag C).

### K4 – Die KI lernt aus Entscheidungen, die gar nicht ausgeführt wurden (mittel)
- **Was:** Stufe 11 (Policies) setzt Aktion und Ziel und protokolliert `ml_followed = true`. Danach überschreibt Stufe 13 (Tagesmodus) beides.
- **Beleg:** Policy Kinder Bad „HIGH, conf 0,95, 35 Proben, **100 % Erfolg**“ – für einen Raum, der seit 10 Tagen keinen Befehl annimmt (K3).
- **Folge:** `learned_policies` und `learning_events` taugen nicht als Grundlage für KI-Vorschläge.

### K5 – Zwei Festlegungen widersprechen sich: Batterie tagsüber (mittel, Entscheidung nötig)
- 27.10. und 01.11.: „Batterie ist für die Nacht reserviert“, „Batterie tagsüber nicht verwenden“.
- 02.11. („Wir machen alle 3“): Batterie-Schutz **nur an Sonnentagen**, an schlechten Tagen „Eco aus jeder Quelle“. So ist es umgesetzt (Zeile 2255).
- **Beleg 10.11.:** schlechter Tag. Von 11 bis 13 Uhr entlud die Batterie im Mittel mit 460–640 W bei 8–10 % Ladestand. Die Nacht davor war sie schon leer (7 %, 2,5–3 kW aus dem Netz).

### K6 – Die Thermostate sind nicht gleich eingestellt (mittel)
Die Logik setzt voraus, dass alle Geräte gleich regeln: Raumfühler, kein Geräte-Nachtprogramm, Korrektur 0.
**Nachtrag 10.11.:** In 3 Tagen zeigt keine der Abweichungen eine Wirkung auf das Heizen (0 Fälle „heizt nicht unter Soll − Band“, Überschreitungen nur bis Soll + Band). Ein Vereinheitlichen ist Ordnung, keine Reparatur. Die Uhr ist bei einem Teil der Geräte um etwa 12 h verschoben (Uli); ohne Wirkung, da Modus „home“ und das Nachtprogramm nachweislich nicht eingreift.

| DP | Erwartet | Abweichend |
|---|---|---|
| 110 Fühlerwahl | 1 (Raumfühler) | **3** bei Toilette Eingang und Bad Uli. Seit 01.11. laut DP-Protokoll unverändert, niemand hat es umgestellt; die Doku vom 01.11. („alle 1“) war falsch. **Nachtrag 10.11.:** Die Auswertung aller Lesungen über 3 Tage zeigt **kein** anderes Regelverhalten – alle Geräte heizen bis Soll + Band, wie DP 101 es vorgibt. |
| 111 Nachtmodus Gerät | aus | **an** bei Büro, Toilette Eingang, Wirtschaftsraum, Wohnzimmer, Zimmer Luis, Zimmer Uli |
| 19 Korrektur | 0 | **−10** bei Kinder Bad (K3) |
| 107 / 106 | 1 / 3 | 107 = 3 bei Toilette Eingang und Wirtschaftsraum; 106 = 1 bei Haustür (Bedeutung unbekannt) |
| 101 Schaltband | 10 | 5 am Wohnzimmer (Test vom 09.11., gewollt) |

### K7 – Drei Stellen rufen `pv-automation` auf (niedrig)
- Cron, Thermostat-Dienst und Fronius-Collector rufen die Funktion auf, also 3 Läufe pro 5 min.
- Eine Runde dauert heute 3–5 s, die Läufe überschneiden sich nicht. Es gibt aber keinen Schutz dagegen.
- `cap_wait_state` wird gelesen, geändert und geschrieben. Zwei gleichzeitige Läufe würden sich gegenseitig überschreiben.
- Dazu ruft jede Runde `evaluate-decision` auf, zusätzlich zum eigenen Cron.

### K8 – Repo und laufender Dienst passen nicht zusammen (niedrig, bekannt)
`tuya-thermostat.js` läuft in v1.3 (setzt Modus „home“ und den Sollwert), das Repo hat v1.1. Seit dem 24.10. offen.

### Möglich, aber heute nicht belegt
- **PV-Budget zählt aus dem Netz heizende Räume mit** (Zeile 1939/1950). Bei PV > 500 W heißt es: Budget = Export **+ Leistung aller heizenden Räume**. Darin stecken auch Räume, die über die Leistungsgrenze aus dem Netz heizen. An einem bewölkten Tag mit etwas Sonne kann das PV-Budget dadurch zu groß werden.
- **Fühler in der Sonne zählt tagsüber nicht zur Grenze.** Der Raum fällt ganz aus der Runde (Zeile 1511). Nachts zählt er mit, wenn er heizt. Heizt das Wohnzimmer mit Sonnenfühler, fehlen bis zu 5,5 kW in der Rechnung. In den letzten 24 h nicht aufgetreten.
- **`calculated_power_w` geht vor `heating_power_w`.** Das würde die am 06.11. gemessenen Raumleistungen überschreiben, falls `calculate-heating-power` je läuft. Heute ist das Feld überall leer, und es gibt keinen Cron dafür.
- **`heatingSettings` ist nicht definiert** (Zeile 3300). Das betrifft nur den Cloud-Modus, wo der ML-Cache nie greift. Lokal ist der Zweig tot, weil keine Tuya-Cloud-Schlüssel gesetzt sind.

### Toter Code
Diese Stufen setzen lokal Ziele, die der Tagesmodus immer überschreibt. Sie erzeugen nur Logs und Lern-Ereignisse:
- harter PV-Gate
- Policies und LLM
- Fallback mit Überschuss-Umleitung
- Rotation und Mikro-Budget (Mikro zuletzt am 19.06. aktiv)

Sie sollten raus, damit die nächste Prüfung überschaubar bleibt. Ein Aufräumen darf aber nichts entfernen, was der Cloud-Modus braucht (Festlegung 26.10.).

---

## 5. Vorschläge

| # | Vorschlag | löst | Art |
|---|---|---|---|
| A | Übertemperatur-Schutz im Lokal-Modus nicht mehr vor dem Tagesmodus abbrechen lassen. Dann entscheidet die Logik vom 09.11. (Abschalten am Ziel). Im Cloud-Modus bleibt der Schutz zum Sparen von Aufrufen. | K1, Ursache von K2 | Code `pv-automation` |
| B | „Allein heizen“ auch erlauben, wenn nur Nachlauf läuft (kein Raum mit zugeteilter Leistung). So kann ein einzelnes Thermostat, das nicht abschaltet, nicht alles blockieren. Gilt für Tag und Nacht. | K2 dauerhaft | Code `pv-automation` |
| C | Eingebaute Wirkungsprüfung: Meldet ein Raum nach 3 ausgeführten Befehlen keinen geänderten Sollwert, gilt er als **nicht steuerbar**. Er bekommt keine Befehle mehr, zählt nicht als steuerbar zur Grenze und erzeugt einen Fehler in Banner, Systemstatus und Mail. | K3, künftige Fälle | Code + SQL |
| D | Kinder Bad vor Ort: Strom aus/ein, sonst Gerät tauschen (Test am 10.11. zeigt: Gerät bestätigt kein Schreiben). | K3 | vor Ort |
| E | Thermostate vereinheitlichen: DP 110 = 1, DP 111 = aus, DP 19 = 0 bei allen; DP 106/107 erst klären. | K6 | Befehle über den Dienst |
| F | Festlegung klären: Batterie an schlechten Tagen tagsüber verwenden – ja oder nein? | K5 | Entscheidung Uli |
| G | Lern-Ereignisse nur noch für das schreiben, was wirklich ausgeführt wurde; Policies bis dahin nicht als KI-Grundlage verwenden. | K4 | Code |
| H | Nur noch **ein** Aufrufer für `pv-automation` (Cron); Collector und Dienst rufen sie nicht mehr auf. | K7 | Code Dienst + Collector |
| I | `tuya-thermostat.js` v1.3 ins Repo. | K8 | Repo |
| J | Toten Code entfernen (Abschnitt oben), ohne Cloud-Funktionen anzutasten. | Prüfbarkeit | Code, später |

**Regel für jede künftige Änderung** (ergänzt die Regel vom 08.11.):
1. In der Tabelle in Abschnitt 2 eintragen, an welcher Stelle die neue Regel greift.
2. Prüfen: Welche Stufe **davor** kann abbrechen? Welche **danach** überschreibt?
3. Prüfen: Wer schreibt dieselben Felder (Abschnitt 3)?
4. Mit echten Daten der letzten Tage nachrechnen, auch über Zeit (Nachlauf, Reservierung, Wechsel zwischen Tagesmodi).
5. Abschnitt 2 und 3 dieses Dokuments aktualisieren.
