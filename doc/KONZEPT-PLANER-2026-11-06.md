# Konzept: Heizplaner statt fester Regeln (06.11.2026)

**Status:** umgesetzt im **Schattenbetrieb** (rechnet und zeigt, steuert nicht).
**Code:** `supabase/functions/heizplaner/` (`modell.ts` Rechenkern, `index.ts` Aufrufe), SQL `25_heizplaner.sql`,
`analysis-scheduler` (Zeitplan), App `src/components/ki/PlanerView.tsx` (KI › 2 Planer), Einstellungen › Haus › Verteilung.

## 1. Warum

Uli, 06.11.2026: „Wir haben eine KI, die mit allen verfügbaren Werten evaluieren soll, welches das beste Heizungsmodell
ist. Was wir hier machen, ist ständig fixe Werte zu definieren, die meist nicht funktionieren. Warum?“

Befund:
- `pv-automation` ist ein Regelwerk (> 4000 Zeilen Wenn-dann). Jedes Problem bekam eine neue Regel mit festem Wert
  (Untergrenze, Batterie-Schutz, Wartetag, Abstand, Grenze, Wartezeit …). Regeln stimmen nur in den Fällen, an die
  man beim Schreiben gedacht hat; am 06.11. früh widersprachen sich „Untergrenze hart“ und „morgens auf PV warten“.
- Die „KI“ entschied nichts: Sie verschob eine Schwelle um ±0,3 und schlug drei Werte vor. Ein Sprachmodell ist auch
  nicht das Werkzeug, um alle 5 min Thermostate zu steuern.
- Die Datengrundlage war schwach: Thermostate folgen erst seit 24.10. den Sollwerten, Raumleistungen waren bis 06.11.
  geschätzt, die Regeln änderten sich fast täglich.

Entscheidung Uli: „dieses Konzept umsetzen“.

## 2. Idee

Das Haus ist ein Physik-Problem. Statt Regeln **rechnet** ein Planer (Modell-prädiktive Regelung):

- **Ziel:** möglichst wenig Netzstrom (fester Tarif → nur die Menge zählt; Einspeisung zählt mit Einspeise-/Bezugspreis).
- **Bedingungen (Wünsche):** je Raum Ziel (Eco tags, Nachtwert nachts), Untergrenze, nie tiefer als Untergrenze −
  Sicherheitsabstand, nicht über Komfort/„Estrich laden bis“; Leistungsgrenze je Zeitabschnitt.
- **Eingaben:** gelerntes Raummodell, gelernte PV-Vorhersage (nachgeführt), Batterie, Grundlast, Außentemperatur.
- **Neu planen alle 15 min** mit den gemessenen Temperaturen → Modell- und Prognosefehler korrigieren sich laufend.

Fragen wie „warten oder jetzt heizen?“, „Batterie zuerst oder Räume?“, „welcher Raum zuerst?“ beantwortet die Rechnung
jeden Tag neu. Uli legt nur fest, **was** er will – nicht, **wie**.

## 3. Bausteine

### 3.1 Raummodell (je Raum gelernt, täglich 03:00, letzte 30 Tage)
`ΔT je 15 min = −k·(T − T_außen) + g·Estrich + s·PV_kW + c`, Estrich = Heizen über τ Stunden verzögert (0/1/2 h geprüft).
- k: Auskühlen, g: Aufheizen beim Heizen (°C/h), s: Sonne, c: innere Wärme/Nachbarräume.
- Gelernt so, dass die **24-h-Simulation** die gemessenen Temperaturen am besten trifft (Nelder-Mead), nicht Schritt für Schritt.
- Räume mit wenig Heizdaten (< 15 h) werden an den Median der anderen Räume angelehnt (Prior).
- Geprüft 06.11.: Nachrechnung 05.11. mit der echten Heizung → im Mittel **0,28 °C** Abweichung; Grad-Stunden unter Ziel
  Modell 113 / gemessen 113. Vorhersage 12 h meist besser als „bleibt gleich“ (Wohnzimmer 0,65 statt 0,91 °C);
  Flur, Kinder Bad, Waschraum heizen nie → nicht besser (dort ändert sich ohnehin kaum etwas).
- Befund Wohnzimmer 05.11.: nach 3 h Heizen stieg die Temperatur noch 2,5 h weiter (Estrich). Das Modell wählt bisher
  τ = 0; mit mehr Daten wird sich zeigen, ob eine Verzögerung besser passt – es lernt jede Nacht neu.

### 3.2 PV-Vorhersage (täglich 03:00)
- Je Stunde des Tages gelernt: `PV ≈ a_h·Direktstrahlung + b_h·Diffusstrahlung` (Open-Meteo, `weather_data`).
  Enthält Dachausrichtung und **Bergschatten** (Forecast.Solar sagt um 16 Uhr 3,4 kW, gemessen 0,17 kW).
- **Nachführung** ab genug Sonne: Verhältnis gemessen/vorhergesagt der letzten 2 h, klingt über 4 h ab.
  Test 14 Tage: Rest-des-Tages-Fehler ab 10 Uhr 7,5 → 6,6 kWh, ab 12 Uhr 5,0 → 3,9 kWh.
- Ehrlich: Hochnebel sagt kein Wetterdienst gut voraus (Tagesfehler Forecast.Solar im Mittel 9 kWh). Deshalb plant der
  Planer alle 15 min neu.

### 3.3 Batterie
Laden aus Überschuss (max 5,5 kW, Wirkungsgrad 0,95), Entladen bei Bedarf (max 5,7 kW) bis 5 %, sonst Netz
(Fronius „0 W Netz“). Restladung am Ende des Plans zählt mit 0,9 (Strom für die Zeit danach).

### 3.4 Planer
- 24 h in 15-min-Schritten, Entscheidung je **halbe Stunde und Raum**: heizen ja/nein.
- Gierige Verbesserung: jeweils den Raum und die halbe Stunde einschalten, die die Gesamtkosten am stärksten senken
  (Netz-kWh + Komfort-Gewichte), solange es etwas bringt und die Leistungsgrenze hält; danach Überflüssiges wieder aus.
- Leistungsgrenze je Abschnitt: `max_grid_heating_power_w` + PV-Überschuss.
- Komfort in kWh-Gegenwert (einstellbar): 1 °C·h unter Ziel = `planer_gewicht_ziel` (0,6 kWh), unter Untergrenze
  zusätzlich `planer_gewicht_unter` (2 kWh), unter Untergrenze − `planer_sicherheit_abstand` (1,5 °C) praktisch verboten.
  Gewichtet nach Priorität (Prio 1 ×1,9 … Prio 12 ×1,0).
  Bedeutung: Kurz etwas unter dem Ziel zu warten, bis Sonne kommt, ist billiger als Netzstrom; an Tagen ohne Sonne
  wächst die Abweichung über Stunden → dann heizt der Planer aus dem Netz. Genau Ulis Regel „Untergrenze hart, wenn keine
  PV kommt; mit PV feinjustieren“ – ohne festen Abstand.
- Manuell übersteuerte Räume und Räume mit Automatik aus werden nicht geplant (bleiben wie sie sind).
- Rechenzeit: 0,1 s je Plan, Lernen 0,2 s je Raum (Edge-Function-Grenze 2 s CPU → ein Aufruf je Raum).

### 3.5 Gegenrechnung (täglich 03:00)
Vortag mit **echter** PV, echtem Wetter, Temperaturen um Mitternacht:
- heutige Steuerung = tatsächliches „heizt“ durch das Modell gerechnet,
- Planer bei denselben Bedingungen,
- Planer bei **gleichem Komfort** wie die Steuerung (Komfort-Gewicht skaliert) → fairer Netzvergleich.

Erste Gegenrechnung 05.11.2026:

| | Heizen | Netz | unter Ziel | unter Untergrenze |
|---|---|---|---|---|
| heutige Steuerung | 33,1 kWh | 18,9 kWh | 104 °C·h | 34 °C·h |
| Planer | 32,2 kWh | 20,3 kWh | 26 °C·h | 0,6 °C·h |
| Planer, gleicher Komfort | 8,7 kWh | 2,0 kWh | 99 °C·h | 26 °C·h |

Gemessen am 05.11.: 21,9 kWh Netz. Mit fast gleichem Strom wären die Räume kaum unter die Untergrenze gefallen.

## 4. Schattenbetrieb → Steuern

1. **Jetzt (Schatten):** `heizplan` alle 15 min, `heizplan_vergleich` täglich. App: KI › Planer zeigt Plan, „Jetzt:
   Planer und heutige Steuerung“, Zeitleiste, Gegenrechnung, Modell je Raum.
2. **Beobachten (einige Tage):** stimmt die Gegenrechnung jeden Tag? Ist der Plan plausibel? Gewichte passend?
3. **Freigabe durch Uli** → Planer steuert: `planer_modus = steuern` (noch nicht gebaut). Dann setzt `pv-automation`
   die Sollwerte nach dem Plan (heizen → Sollwert über Ist bis Ziel, nicht heizen → Ist − 0,5 °C), die Sicherheitsregeln
   (Manuell, Übertemperatur, Frostschutz, Thermostat-Fehler) bleiben. Das Regelwerk wird danach schrittweise abgebaut.

## 5. Was Uli festlegt (Wünsche) – und was nicht mehr

- Bleibt: je Raum Eco, Nachtwert, Untergrenze, Komfort/„Estrich laden bis“, Priorität; Haus: Leistungsgrenze,
  Nachtzeiten; Planer: Gewicht Ziel/Untergrenze, Sicherheitsabstand.
- Nächster Schritt (offen): **Wünsche je Raum und Uhrzeit** (z. B. Wohnzimmer 8–22 Uhr 21 °C, Zimmer Luis tagsüber,
  Schlafzimmer nachts) statt nur Tag/Nacht – Uli am 06.11.: nach 8 Uhr sind alle im Wohnzimmer oder Luis in seinem Zimmer.
- Entfällt mit dem Steuern: Wartetag/Netztag/Batterie-Schutz-Schwellen, Abstand, Wartezeit-Vorrang, Mikro-Budget,
  Rotation – das entscheidet die Rechnung.

## 6. Offene Punkte
- Wünsche je Raum und Uhrzeit (Belegung).
- Estrich-Verzögerung τ beobachten (bisher 0 gewählt).
- Modus „steuern“ bauen, sobald der Schattenbetrieb überzeugt.
- PV: Forecast.Solar zusätzlich als Eingang prüfen; Schnee auf den Modulen erkennen (30.10.: wolkenlos, aber 11 statt 38 kWh).
