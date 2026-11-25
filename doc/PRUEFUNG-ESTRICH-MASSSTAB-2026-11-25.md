# Prüfung Estrich-Maßstab (25.11.2026)

Bezug: claude/PRUEFUNG-STUFE-2D-ENERGIEBEDARF-2026-11-23 (Befund „Maßstab 5–30× zu groß“), Aktion `modell_pruefen`
(heizplaner/modellpruefung.ts, PR #91/#92). **Nur gelesen, nichts geändert.**

## Frage
Das Raummodell speichert im Estrich-Knoten ~126 kWh/°C fürs ganze Haus (Leistung / g). Ein 6-cm-Zementestrich hätte
nur ~7 kWh/°C (Fläche × 30 Wh/m²·°C). Ist der gelernte Wert falsch – und sollen wir den physikalischen Wert einbauen?

## Vorgehen
Je Raum, 30 Tage: Lernen auf den ersten 70 %, Vorhersage 12 h im Voraus auf den letzten 30 % (nie gesehen).
Varianten: frei gelernt (wie jede Nacht) und mit fest vorgegebener Speichermenge = 1×, 4×, 16× Physik.
Fehler = mittlere Abweichung der Raumtemperatur nach 12 h (°C); „gleich“ = Annahme „Temperatur bleibt, wie sie ist“.

## Ergebnis (12-h-Vorhersage im Prüfzeitraum, °C)

| Raum | gleich | frei | Physik 1× | 4× | 16× | frei kWh/°C | Physik kWh/°C |
|---|---|---|---|---|---|---|---|
| Bad Uli | 0,51 | 0,36 | 0,40 | 0,38 | 0,35 | 17,0 | 0,60 |
| Büro | 0,45 | 0,38 | 0,39 | 0,51 | 0,39 | 12,3 | 0,45 |
| Flur | 0,16 | 0,12 | 0,15 | 0,10 | 0,08 | 0,9 | 0,30 |
| Haustür | 0,57 | 0,44 | 0,85 | 0,48 | 0,47 | 5,8 * | 0,15 |
| Kinder Bad | **0,07** | 0,13 | 0,31 | 0,17 | 0,09 | 2,7 | 0,45 |
| Toilette Eingang | **0,32** | 0,40 | 0,93 | 0,47 | 0,41 | 2,0 * | 0,09 |
| Waschraum | **0,24** | 0,29 | 0,76 | 0,25 | 0,29 | 5,0 * | 0,21 |
| Wirtschaftsraum | 0,51 | 0,48 | 1,42 | 0,74 | 0,53 | 12,8 | 0,36 |
| Wohnzimmer | 1,11 | 0,69 | 0,80 | 0,68 | 0,70 | 4,9 | 1,95 |
| Zimmer Luca | 0,45 | 0,27 | 0,38 | 0,33 | 0,27 | 9,5 | 0,66 |
| Zimmer Luis | 0,59 | 0,35 | 0,50 | 0,35 | 0,34 | 18,5 | 0,66 |
| Zimmer Uli | 0,37 | 0,21 | 0,43 | 0,29 | 0,21 | 9,4 | 0,75 |

\* g an der Untergrenze 0,05 – die Daten wollen einen noch größeren / trägeren Speicher.

## Bewertung
1. **Physikalischer Estrich-Wert NICHT einbauen.** Mit 1× Physik wird die Vorhersage in 11 von 12 Räumen schlechter,
   teils doppelt so schlecht (Wirtschaftsraum 1,42 statt 0,48 °C). Die Daten entscheiden den Maßstab also sehr wohl –
   und sie wollen einen großen, trägen Speicher (≈ 15–30× Estrich). Der „Estrich“-Knoten steht offenbar für die ganze
   Speichermasse (Betondecke, Wände), nicht nur für den Estrich. Der Befund vom 23.11. („5–30× zu groß“) ist damit
   widerlegt; die Bereinigung um gespeicherte Wärme ist nicht nachweislich falsch (aber unsicher, s. 3).
2. **Drei Räume sagt das Modell schlechter voraus als „bleibt gleich“:** Kinder Bad, Toilette Eingang, Waschraum
   (alle ohne Fenster bzw. sehr klein). Dort lernt das Modell etwas Falsches – das ist die eigentliche Baustelle.
3. Mehrere Räume liegen mit g an der Untergrenze (Speicher am Maximum). Ein Hinweis, dass ein dritter, langsamer
   Speicher (Gebäudemasse) oder eine weitere Grenze fehlt – noch nicht geprüft.
4. Heutige Vorhersagegüte: 12 h im Voraus meist 0,2–0,5 °C, Wohnzimmer 0,7 °C (Kamin, Sonne auf dem Fühler).

## Nächste Schritte (Vorschlag, nicht umgesetzt)
- Die Prüfung „Vorhersage auf nie gesehenen Daten“ als Kennzahl jede Nacht speichern und als Verlauf zeigen:
  So sieht man, ob die KI mit der Zeit wirklich besser wird (Ulis Ziel: Wirkung der Aktionen sicher vorhersagen).
- Für Kinder Bad, Toilette Eingang, Waschraum untersuchen, warum das Modell schlechter als „gleich“ ist.

## Ablauf-Hinweis
Erster Lauf mit 84 gleichzeitigen Aufrufen überlastete die Datenbank (25.11. 06:55, fünf Cron-Jobs je 1× fehlgeschlagen,
selbst erholt). Höchstens 4 Aufrufe gleichzeitig, mit Pause dazwischen.
