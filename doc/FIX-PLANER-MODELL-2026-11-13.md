# Planer steuert: neues Raummodell, Modus „steuern“, Sprach-KI entfernt (13.11.2026)

**Auftrag Uli (13.11.2026):** „Ich will eine effektive Automation der Heizungssteuerung, kein Mockup. Die KI muss die
Oberhand über die Planung haben.“ – „Die KI sollte Muster erkennen, um die Heizung zu optimieren, wie kann das eine
Sprachsteuerung machen?“ – „1 bis 4 umsetzen und Sprach-KI entfernen.“

**Anlass:** 13.11. 09:03–09:53 heizte das Wohnzimmer (5,6 kW) aus dem Netz, weil es unter der Untergrenze lag
(Regelwerk). Der Planer hätte bis ~12:30 gewartet – im Schattenbetrieb wurde das nicht umgesetzt und nirgends angezeigt.

**Dateien:** `supabase/functions/heizplaner/` (`modell.ts`, neu `rechnen.ts`, `index.ts`), `pv-automation`,
`ai-parameter-advisor`, `analysis-scheduler`, entfernt `analyze-patterns`, `analysis-summary`; App
`AutoSteuerung`, `PlanerView`, `RaumModellView`, `HouseOverview`, `KiTab`, `SettingsPanel`, `Index`; SQL 37.

---

## 1. Befund: Das alte Raummodell hätte das Haus auskühlen lassen

Gegenrechnung 12.11. mit dem alten Modell: Planer 12,8 kWh Heizen statt 40,9 kWh – und trotzdem wärmere Räume.
Physikalisch unmöglich. Drei Ursachen:

| # | Ursache | Beleg |
|---|---|---|
| 1 | **Ein Wärmespeicher je Raum.** Die verzögerte Wärme aus dem Estrich landete in der „inneren Wärme“ c. | Summe c über alle Räume ≈ **8 kW** bei 240 W Grundlast |
| 2 | **Wärmespeicher am Planende ohne Wert.** Batterie-Restladung zählte, die Wärme im Estrich nicht. | Plan 13.11.: Wohnzimmer 20,5 → 19,8 °C, Büro 21 → 20 °C am Planende |
| 3 | **Einzelne Räume falsch:** Wirtschaftsraum „Heizen bringt nichts“ (g = 0) → würde auf 17,7 °C auskühlen; Kinder Bad (nimmt keine Befehle an) 12 h geplant. | `heizmodell` 13.11. |

## 2. Neues Raummodell (zwei Speicher)

```
dS/dt = g·h − u·(S − T)                        Estrich
dT/dt = r·u·(S − T) − k·(T − T_außen) + s·PV_kW + c     Raumluft
```
g Aufheizen des Estrichs beim Heizen, u Austausch Estrich → Raum, r Estrich-Speicher / Luft-Speicher, k Verlust nach
draußen, s Sonne, c innere Wärme (begrenzt auf −0,03…0,04 °C/h). Gelernt wie bisher jede Nacht (Nelder-Mead über
24-h-Simulationen), Parameter über S-Kurven in physikalischen Grenzen. Der Estrich-Zustand zu Beginn wird aus den
12 h davor (gemessene Temperatur + Heizen) nachgerechnet. `param.v = 2` kennzeichnet das neue Modell; alte Zeilen
nimmt der Planer nicht (Standardwerte, und `pv-automation` steuert solche Räume nicht nach Plan, `m2 = false`).

**Verworfen: Kopplung an die Nachbarräume.** Mit dem gemessenen Mittel der anderen Räume als Eingang lernte das
Modell, dass die Räume kaum nach draußen verlieren und einfach den Nachbarn folgen (k an der Untergrenze, Kopplung an
der Obergrenze). Die 12-h-Vorhersage war dadurch gut – im Plan wäre das Haus aber nie ausgekühlt.

### Geprüft mit echten Daten (14 Tage Messwerte, 13.11.2026)

| Raum | Fehler 12 h alt | neu | „bleibt gleich“ | Verlust bei 18 °C |
|---|---|---|---|---|
| Bad Uli | 0,54 | **0,46** | 0,65 | 171 W |
| Zimmer Uli | 0,42 | **0,40** | 0,49 | 118 W |
| Zimmer Luis | 0,59 | **0,54** | 0,67 | 175 W |
| Zimmer Luca | 0,39 | **0,27** | 0,44 | 97 W |
| Kinder Bad | 0,24 | **0,17** | 0,11 | 30 W |
| Büro | 0,61 | 0,72 | 1,03 | 106 W |
| Wohnzimmer | 0,61 | **0,58** | 0,85 | 1063 W |
| Flur | 0,28 | **0,27** | 0,26 | 43 W |
| Wirtschaftsraum | 0,48 | **0,44** | 0,54 | 361 W |
| Haustür | 0,32 | 0,36 | 0,54 | 44 W |
| Toilette Eingang | 0,64 | **0,55** | 0,79 | 52 W |
| Waschraum | 0,16 | 0,17 | 0,13 | 36 W |

- 9 von 12 Räumen besser; Büro ist seit 07.11. offline (wenig Daten), Haustür knapp schlechter.
- **Hausbilanz:** zusammen ~2,3 kW Verlust bei 18 °C Unterschied ≈ 55 kWh/Tag – gemessen 40–42 kWh Heizen an den
  kalten Tagen (dazu Sonne und Kamin). Innere Wärme zusammen ~60 W statt 8 kW.
- Modell mit echter Heizung gegen Messung: 0,22 °C (12.11.), 0,27 °C (11.11.), vorher 0,30/0,41 °C.

## 3. Planer: Wärme am Planende, Ausnahmen, Abwesenheit

- **Wärmespeicher zählt:** Die Wärme in Estrich und Luft am Planende gegenüber jetzt (`waermeKwh`) geht mit 0,9 je kWh
  in die Kosten ein, wie die Restladung der Batterie (`Gewichte.waermeRest`). Ein Plan „spart“ nicht mehr, indem er den
  Estrich leert. Mit PV-Überschuss (Einspeisewert ~0,23) lohnt es sich dagegen, Wärme bis Komfort einzulagern.
- **Nicht steuerbare Räume** (`rooms.nicht_steuerbar_seit`) plant er nicht – sie heizen im Plan, wie sie gerade heizen.
- **Abwesenheit** (Kalender `presence_periods`, Vorlauf wie in `pv-automation`): tagsüber Ziel = Untergrenze.
- Rechnen ohne Datenbank in `rechnen.ts` (`lerneAus`, `planAus`, `vergleichAus`) – dieselben Funktionen für Betrieb
  und Prüfung.

### Gegenrechnung neu (fair: Wärme ausgeglichen)

„Planer bei gleichem Komfort“ entfällt (mit dem Wärmewert leerte die skalierte Rechnung den Estrich). Neu
`planer.netz_bereinigt_kwh` = Netz des Planers − (Wärme Planer − Wärme Steuerung) am Tagesende.

| Tag | Steuerung Netz | Planer Netz (Wärme ausgeglichen) | unter Ziel Steuerung → Planer | unter Untergrenze |
|---|---|---|---|---|
| 10.11. | 31,1 kWh | **30,9 kWh** | 110 → **52 °C·h** | 59 → 41 |
| 11.11. | 25,1 kWh | **24,2 kWh** | 75 → **42 °C·h** | 39 → 38 |
| 12.11. | 39,7 kWh | **39,6 kWh** | 89 → **45 °C·h** | 45 → 41 |

Gleich viel Netzstrom, die Räume liegen nur halb so lange unter dem Ziel. „Unter Untergrenze“ bleibt hoch, weil das
Kinder Bad (nimmt keine Befehle an) bei 19,5 °C steht (Untergrenze 21 °C) – ~36 °C·h am Tag allein dieser Raum.
Rechenzeit: Plan 0,12 s, Gegenrechnung 0,09 s.

## 4. Modus „steuern“

`heating_settings.planer_modus = 'steuern'` (Auto-Steuerung › Steuerung, Knopf „Steuern“; zurück jederzeit mit „Schatten“).

`pv-automation` liest bei jedem Lauf (5 min) den jüngsten `heizplan` (≤ 30 min alt, `ladePlanerPlan`) und nimmt je
Raum den aktuellen 15-min-Slot. `planerSollwert` setzt das in einen Sollwert um (Schaltband DP 101 beachtet):

| Plan sagt | Sollwert |
|---|---|
| heizen, Thermostat läuft schon und hört nicht vor dem Ziel auf | bleibt (kein Befehl) |
| heizen, Thermostat aus | max(Ziel, aufgerundet Ist + Band + 0,2), höchstens Komfort + Band → schaltet sicher ein |
| nicht heizen, Thermostat aus und Soll ≤ Ist − 0,3 | bleibt |
| nicht heizen, sonst | abgerundet Ist − Band − 0,5 (Thermostat aus) |

**Sicherheit bleibt immer:** manuell übersteuert, Automatik aus, Fühler in der Sonne, nicht steuerbar (werden vorher
aussortiert, wie bisher); Raum unter Untergrenze − Sicherheitsabstand → heizt, auch wenn der Plan anderes sagt; Raum ≥
Komfort + 0,3 °C → aus. **Rückfall Regelwerk:** Plan älter als 30 min, fehlt, passt nicht zur Uhrzeit, oder Raum ohne
neues Modell (`m2 = false`). Tag und Nacht gleich (Nacht nur bei „Nachtwert halten“; „Frostschutz“ bleibt Regel).

Anzeige: Raumkarte „Automatik: Planer: …“, Übersicht „Planer steuert“, `heating_day_mode.planer` /
`heating_night_mode.planer` (steuert ja/nein, Stand).

Im Modus „steuern“ ohne Wirkung (nur noch Rückfall): Tagesart, Wartetag, Batterie-Schutz, PV-Budget Phase 1/2,
Leistungs-Zuteilung des Regelwerks. Die Leistungsgrenze hält der Planer selbst (`max_grid_heating_power_w` + PV-Überschuss).

## 5. Sprach-KI entfernt

| entfernt | was es tat | Ersatz |
|---|---|---|
| `analyze-patterns` (Gemini) | Mustergedächtnis match_today/Woche/Monat, LLM-Entscheidung je Raum (nur Cloud-Modus) | Heizplaner (gelerntes Modell) |
| `analysis-summary` (Gemini) | Klartext-Zusammenfassungen Tag/Woche/Monat | Tagesanalyse `ki-tagesanalyse` (feste Satzbausteine mit Messwerten) |
| `ai-parameter-advisor` Hauptpfad (Gemini) | Parameter-Vorschläge auf Knopfdruck | `ki-tagesanalyse`; geblieben: `/suggest-battery-soc` (feste Rechnung) |
| `pv-automation` LLM-Zweig | `optimize_decision` alle 60 min, `room_recommendations` | – (Cloud-Steuerung selbst bleibt erhalten, Festlegung 26.10.) |
| App | KI › „Lernen & Qualität“, „Auswertungen“, Einstellungen › KI › Mustergedächtnis, „Jetzt analysieren“, `ProgressCockpit` (unbenutzt) | Auto-Steuerung |

`compute-daily-score` (feste Rechnung, Grundlage des Batterie-Vorschlags) bleibt. Secrets `GOOGLE_AI_API_KEY` und
`ANTHROPIC_API_KEY` werden von keiner Function mehr gelesen.

## 6. Nebenwirkungen geprüft

| Stelle | nach der Änderung |
|---|---|
| `heizmodell.param` | neue Form (v = 2). Leser: Planer, `pv-automation` Vorausschau (rechnet jetzt k/(1+r)), App Raummodell (Abfall mit k/(1+r), Aufheizen `auf`) |
| `heizplan.plan.raeume[].m2`, `.waerme_kwh` | neu; App liest sie nicht (nur `pv-automation`) |
| `heizplan_vergleich.planer.netz_bereinigt_kwh`, `waerme_kwh` | neu; App (Gegenrechnung), SQL 37 → `energie_tag.planer_netz_kwh` |
| `planer_gleich` | ab jetzt `null`; App zeigt alte Zeilen mit „(alte Rechnung)“ |
| `heating_day_mode` | Feld `planer`, `rooms` enthält auch Räume nach Plan; App Übersicht/Raumkarte |
| `thermostat_commands` | im Modus „steuern“ Befehle nach Plan statt Tagesmodus; Anzahl ähnlich (Sollwert bleibt, wo er schon wirkt) |
| `cap_wait_state` | wird weiter geschrieben (Rückfall), im Modus „steuern“ ohne Wirkung |
| Lern-Ereignisse | `entschieden_von = tagesmodus` auch für Planer-Räume (Feld unverändert) |
| Übertemperatur-Schutz (Lokal) | Planer-Räume haben ein Tagesziel → wie Tagesmodus: entscheidet der Plan |

**Verhalten über Zeit:**
- Plan-Lauf fällt aus → nach 30 min Regelwerk, beim nächsten Plan zurück.
- Thermostat antwortet nicht → `nicht_steuerbar` (SQL 30), Planer plant ihn nicht.
- Erster Tag nach dem Einspielen: Modelle noch alt → Lernen sofort anstoßen (siehe 7.), sonst Rückfall bis 03:00.
- Tag/Nacht: gleicher Weg; Abend wie bisher (Planer kennt Nachtwert/Untergrenze).
- Abwesenheit: Planer-Ziel Untergrenze; Kalender nicht lesbar → anwesend (wie bisher).

**Bewusst nicht geändert:** Regelwerk-Code (Rückfall, Cloud-Modus) – Abbau erst nach einigen Tagen „steuern“;
Bereinigung 2b (PV-Prognose) und 2d (Energiebedarf) betreffen nur noch den Rückfall.

## 7. Einspielen

1. **SQL 37** ausführen (nur `energie_tag_rechnen`, Kommentar `planer_modus`).
2. **PR mergen** → GitHub-Aktion deployt `heizplaner`, `pv-automation`, `ai-parameter-advisor`, `analysis-scheduler`; Vercel die App.
3. **Lernen anstoßen:** `analysis-scheduler` mit `force = heizplaner_lernen` (Claude per SQL oder Supabase-Dashboard) →
   `heizmodell` hat `param.v = 2` für alle Räume.
4. Auto-Steuerung › Gegenrechnung prüfen, dann **„Steuern“** drücken.
5. Im Supabase-Dashboard löschen: `analyze-patterns`, `analysis-summary`, `heizplaner-pruefung` (Prüffunktion, abgeschaltet).
   Secrets `GOOGLE_AI_API_KEY`, `ANTHROPIC_API_KEY` löschen.

## 8. Prüfen nach dem Umschalten

- Log `[PLANER-STEUERT] Plan von hh:mm: 12 Räume nach Plan`.
- Raumkarten „Automatik: Planer: …“; Übersicht „Planer steuert“.
- Am nächsten Morgen: Gegenrechnung und Verlauf › Netz vs. „Planer bei gleicher Sonne“.

## 9. Rückweg

„Schatten“ drücken (sofort wirksam, nächster Lauf nach Regelwerk). Code: PR zurücknehmen; SQL 37 kann bleiben.
