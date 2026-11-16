# Konzept: Hin und Her der Sollwerte dauerhaft beenden (16.11.2026)

**Status:** Entwurf zur Entscheidung (Uli). Noch kein Code.
**Anlass (Uli, 16.11.2026, 11:42/11:44):** „Wieso sind wir nicht in der Lage, dieses Problem auszumerzen?“ – „Wieso hat
sich wieder so ein Problem aufgetan? Dieses Problem müssen wir lösen. Lies die gesamte Doku vorher und den Code.“
**Gelesen:** Master-Doku, alle Konzept-/FIX-/Prüfungs-Dokus zur Steuerung seit 27.10., `pv-automation/index.ts`
vollständig (4.338 Zeilen), `_shared/heizregeln.ts`, `heizplaner` (Teile), Befehle und Messwerte der letzten 7 Tage.

---

## 1. Was „Hin und Her“ heißt – und wie oft es vorkommt

Ein Raum bekommt einen Sollwert, kurz darauf einen anderen und dann wieder den ersten (A → B → A in ≤ 15 min).
Das kostet keine Sicherheit, aber Befehle, Thermostat-Schaltungen und – bei PV – verschenkten Sonnenstrom.

| Tag | Befehle | A → B → A in 15 min | Anteil |
|---|---|---|---|
| 09.11. | 392 | 30 | 7,7 % |
| 10.11. | 465 | 2 | 0,4 % |
| 11.11. | 388 | 26 | 6,7 % |
| 12.11. | 358 | 5 | 1,4 % |
| 13.11. | 358 | 7 | 2,0 % |
| 14.11. | 557 | 43 | 7,7 % |
| 15.11. | 430 | 15 | 3,5 % |
| 16.11. (bis 11:45) | 328 | 33 | 10,1 % |

(Korrektur zu meiner Aussage im Chat um 11:42: Dort nannte ich 63 von 328 = 19 %. Die Abfrage hatte nur den letzten
Schritt auf 15 min geprüft. Streng gezählt sind es 33 = 10 %.)

**Wer gegen wen (letzte 3 Tage, A → B → A):**

| Folge | Anzahl | Stand |
|---|---|---|
| Batterie-Notfall-Stop ↔ Tagesmodus (Min-Vorrang) | 63 | **behoben** mit PR #68 (seit 09:30 kein Stop-Befehl mehr) |
| Tagesmodus ↔ Tagesmodus | 10 | offen – Muster M2 unten |
| Nacht ↔ Nacht | 12 | offen – Muster M2 (Nachtpfad) |
| Planer ↔ Batterie-Notfall-Stop | 5 | behoben mit PR #68 |

**Weitere Muster mit längerem Abstand (7 Tage):**

| Muster | Anzahl | Wirkung |
|---|---|---|
| **M1** PV-Budget vergeben (Normal/PV-Max) → wenige Minuten später Tagesmodus „hält Min“ | **28** (davon PV-Max 11, im Mittel nach 5,5 min) | PV-Max kommt fast nie an; Sonne geht in die Batterie/ins Netz statt in den Estrich. Genau das stand schon am 07.11. als „Befund b“ in `FIX-KOMFORT-IST-MAXIMUM-2026-11-07.md` |
| **M2** „Ziel erreicht → Thermostat aus“ (Soll z. B. 20) → nächster Lauf „hält Min“ (Soll wieder 21) | **99** | reine Befehls-Unruhe: das Thermostat heizt bei Soll 21 und Ist 21,6 ohnehin nicht |

Seit PR #68 (09:30 bis 11:45): 56 Befehle, davon 2 × A → B → A (beides M2) plus 1 × M1 (Toilette 11:32/11:35).

---

## 2. Warum es immer wieder auftaucht

**Ehrliche Antwort: weil bisher jedes Mal das einzelne Symptom repariert wurde, nicht die Bauweise.**
Die Prüfung vom 10.11. (`PRUEFUNG-REGELN-WECHSELWIRKUNGEN-2026-11-10.md` §1) hat das schon festgestellt;
die Folgerung „toten Code entfernen, Stufen zusammenführen“ (Vorschlag J) wurde nie umgesetzt, und „Befund b“ vom 07.11.
wurde mit „erst Konzept mit Uli“ zurückgestellt und nie wieder aufgenommen. Das ist ein Versäumnis von Claude.

Im Code sind es vier konkrete Ursachen:

1. **Sieben Stellen schicken Sollwerte** (`setTemperatureForMode` in Zeile 1306 Frostschutz, 1525 Nacht, 2450
   Batterie-Notfall-Stop, 2887 Mikro-Ende, 3505 Übertemperatur, 4041 Raumschleife hoch, 4118 Raumschleife runter).
   (Im Chat um 11:42 sagte ich acht – die achte Fundstelle war die Funktion selbst.) Jede Stufe rechnet in jedem Lauf (alle 5 min) **von vorn**. Kein Teil weiß, was ein
   anderer im letzten Lauf entschieden hat – ein Gedächtnis gibt es nur für Min-Räume (`cap_wait_state`).
2. **PV-Max-Budget = nur echte Einspeisung** (Zeile 2282 „reaktiv“). Fängt ein Raum an zu heizen, sinkt die Einspeisung
   genau um seine Leistung – im nächsten Lauf ist das Budget weg, der Raum fällt in den Tagesmodus „hält Min“. Das
   Normal-Budget (Phase 1) rechnet laufende Räume dazu (`currentlyHeatingPower`), das PV-Max-Budget nicht.
3. **„Heizt“ kommt bis zu 5 min später.** Die Start-Schwelle (Export ≥ 500 W, Zeile 2772) prüft `is_heating` (DP 5).
   Ein Raum, der den Befehl gerade bekommen hat, heizt beim nächsten Lauf oft noch nicht – er gilt als *neuer* Start,
   die Schwelle sperrt, und er verliert sein Budget, bevor er angefangen hat.
4. **Die Sperre wirkt nur in eine Richtung.** Die Mindestzeit zwischen zwei Befehlen (`min_switch_interval_min`, 25 min)
   bremst nur das Hochstellen; Senken gilt als „Sicherheit“ und darf immer (Zeile 3893). Hoch → runter geht also sofort.
   Dazu setzt der Tagesmodus nach „Ziel erreicht → aus“ im nächsten Lauf wieder „hält Min“ (Muster M2, Zeile 485–489,
   Nacht 1461–1462).

---

## 3. Lösung

### Stufe A – jetzt (ein PR, nur `pv-automation`)

**A1. Eine Haltezeit an der Stelle, an der jeder Befehl rausgeht.** Alle Tag- und Nacht-Befehle laufen durch
`setTemperatureForMode`. Davor kommt eine einzige Prüfung:

> Ein neuer Sollwert, der den letzten Befehl dieses Raums **umkehrt** (zurück auf den Wert davor bzw. andere Richtung),
> wird innerhalb von **15 min** nach dem letzten Befehl nicht geschickt.

Ausnahmen – diese dürfen immer:
- Raum unter **Min + Vorlauf** (Min hat Vorrang, 14.11.)
- Raum ≥ **PV-Max + 0,3 °C** (zu warm)
- Abschalten am Ziel (Ist ≥ Ziel + 0,3 °C) – nur wenn es nicht direkt einen eigenen Befehl der letzten 15 min umkehrt
- manuell, Nacht-Frostschutz, nicht steuerbar (Prüfbefehl)

Jede unterdrückte Umkehr steht im Log und in der Begründung des Raums („Haltezeit: Befehl von 11:32 gilt bis 11:47“).
Damit gibt es **eine** Stelle, die das letzte Wort hat – egal, welche Stufe den Vorschlag gemacht hat.

**A2. PV-Budget mit Gedächtnis.** Wer PV-Budget bekommen hat (Normal oder PV-Max), behält es mindestens 15 min bzw. bis
zum Ziel, solange Einspeisung **plus seine eigene Leistung** die Aus-Schwelle (`pv_surplus_threshold_off`, 200 W)
erreicht – wie Phase 1 es für laufende Räume schon macht. Zustand in `system_settings.pv_grant_state` (wie
`cap_wait_state`). Ein Raum mit frischem Befehl zählt in den ersten 15 min als „läuft“, auch wenn DP 5 noch „0“ meldet
(gleiche Anlaufzeit wie bei Min, `cap_keep_start_min`).

**A3. Nach „aus“ nicht wieder hochsetzen.** Liegt der Raum über Min und der Sollwert schon darunter (Thermostat aus),
bleibt der Sollwert stehen – statt im nächsten Lauf wieder „hält Min“ zu schicken. Erst wenn der Raum Richtung Min fällt,
übernimmt der Min-Vorrang (mit Anstoß). Gilt für Tag (`allocateDayTargets`) und Nacht (`nightPlan`).

### Stufe B – danach (eigener PR, nach einigen Tagen mit A)
Toten Code entfernen (Prüfung 10.11., Vorschlag J): Mikro-Budget (zuletzt aktiv 19.06.), Rotation/Pause, alter
Übertemperatur-Schutz im Lokal-Modus, Fallback-Zweige. Ziel: von sieben Sende-Stellen auf zwei (Tag, Nacht). Cloud-Teile
bleiben (Festlegung 26.10.).

### Stufe C – Ziel (bereits geplant)
„KI steuert“ (Planer im Regel-Rahmen, 16.11.) ersetzt die Budget-Stufen; das Regelwerk bleibt nur als Rahmen.
Die Haltezeit A1 gilt dann genauso für den Planer.

---

## 4. Nachgerechnet mit echten Daten (7 Tage, nur lesend)

| | ohne Änderung | mit Stufe A |
|---|---|---|
| PV-Budget nach ≤ 15 min wieder entzogen (M1) | 28 | 0 (Budget hält 15 min) |
| dadurch zusätzlich geheizt | – | höchstens **4,0 kWh in 7 Tagen** |
| davon aus dem Netz | – | gering: in diesen Minuten lag die PV im Mittel bei **5,5 kW**, Netzbezug **0,28 kW**, Batterie **74 %** – die Wärme kommt fast ganz aus der Sonne und landet im Estrich (gewollt, Uli 07.11.) |
| „aus → hält Min“-Befehle (M2) | 99 | 0 |
| A → B → A seit PR #68 | 2 von 56 | 0 erwartet |
| Raum unter Min durch die Haltezeit | – | **nicht möglich**: unter Min + Vorlauf darf immer geschaltet werden |

## 5. Nebenwirkungen (Regel 08.11.2026) – geprüft am Entwurf

1. **Wer liest/schreibt dieselben Daten:** `thermostat_commands` (letzter Befehl je Raum – wird schon für den Prüfbefehl
   gelesen), neu `system_settings.pv_grant_state` (nur `pv-automation`). Der Planer im Modus „KI steuert“ läuft über
   dieselbe Sende-Stelle → bekommt dieselbe Haltezeit. App: Begründung „Haltezeit …“ erscheint in „Heizung jetzt“.
2. **Über Zeit:** Wolke 10 min → Raum heizt weiter (aus Batterie, kurz); Wolke > 15 min → normal aus. Tag/Nacht-Wechsel:
   Nacht hat Vorrang vor der Haltezeit nur für Absenken auf Min (Frostschutz/Min-Ziel). Dienstausfall: Befehl wird nicht
   geschickt → kein „letzter Befehl“ → keine Haltezeit (fail-open).
3. **Mit echten Daten:** Abschnitt 4. Vor dem Einspielen rechne ich die Entscheidungen von A1–A3 Lauf für Lauf auf
   die Messwerte der letzten 3 Tage nach (wie viele Befehle fallen weg, welcher Raum wäre wann wie warm gewesen).
4. **Messen danach:** Anteil A → B → A je Tag als Zahl in Protokoll bzw. „Wo stehen wir?“ – Ziel **unter 2 %**.

## 6. Zu entscheiden (Uli)

1. **Haltezeit 15 min** für jede Umkehr (außer den Ausnahmen) – passt das?
2. **PV-Budget hält 15 min**, auch wenn die Sonne kurz weg ist (dann heizt der Raum so lange aus der Batterie) – ja?
3. Reihenfolge: **Stufe A jetzt**, Stufe B (toter Code) nach einigen Tagen?
