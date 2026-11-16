# FIX: Pingpong Batterie-Schutz ↔ Min-Vorrang (16.11.2026)

## Befund

Am 16.11.2026 ab 09:02 (Batterie 5 %, Tagesmodus `battery_gate`) bekamen Büro, Haustür, Toilette Eingang und
Wirtschaftsraum alle 2–5 Minuten abwechselnd zwei verschiedene Sollwerte:

| Zeit | Büro | Grund |
|---|---|---|
| 09:02 | 22,5 °C | Tagesmodus battery_gate: knapp über Min … Anstoß 22,5 °C |
| 09:05 | 21 °C | Batterie-Schutz (SOC 5,3 %) → Min − Abstand = 21 °C |
| 09:10 | 22,5 °C | Tagesmodus battery_gate: … Anstoß |
| 09:12 | 21 °C | Batterie-Schutz … |
| 09:17 | 21,2 °C | Tagesmodus battery_gate: … behält Leistung bis Ziel |

Seit 14.11.2026 abends: **77 Befehle** des Notfall-Stops.

## Ursache – doppelte Logik in `pv-automation`

1. **SOC-Gate-Notfall-Stop** (27.10.2026, `[SOC-GATE-STOP]`): Bei SOC unter `heating_min_battery_soc` (strict) setzt er
   jeden Raum, dessen Soll über Min liegt, auf Min.
2. **Raumschleife, Tagesmodus `battery_gate`** (Min hat Vorrang, 14.11.2026): setzt im selben Lauf Räume unter Min + Vorlauf
   auf 21,2 °C bzw. den Anstoß-Sollwert 22,5 °C, Räume über dem Ziel auf aus.

Der Stop läuft zuerst, die Raumschleife danach. Der Kommentar im Code („dadurch kein Pingpong mehr“) galt vor dem
Min-Vorrang; seit 14.11. widersprechen sich beide. Folge: unnötige Befehle, Thermostate schalten kurz ab und wieder ein,
Heizen bis Min wird unterbrochen.

## Änderung

`supabase/functions/pv-automation/index.ts`: Der Notfall-Stop läuft nur noch, wenn das **Leistungsbudget aus** ist
(`power_budget_enabled = false`). Mit Leistungsbudget (Ulis Einstellung) setzt die Raumschleife für jeden gesteuerten Raum
das Ziel selbst (Zeile „Tagesmodus“ im Raum-Loop: `powerBudgetEnabled && dayFb && !budgeted`) – der Stop ist dann doppelt.
Das Budget bleibt unverändert: bei aktivem Gate nur Heizen aus echter Einspeisung.

Neu im Log: `[SOC-GATE-STOP] übersprungen – Leistungsbudget an, die Raumschleife setzt die Ziele`.

## Nebenwirkungen geprüft (Regel 08.11.2026)

1. **Wer schreibt dieselben Daten:** Nur die Raumschleife setzt bei aktivem Gate noch Sollwerte. Der Stop schrieb zusätzlich
   `rooms.heating_paused_reason = 'SOC-Gate …'` – das liest kein Frontend und keine Function (geprüft), fällt mit weg.
   Übersteuerte Räume und Räume ohne Automatik ließ der Stop schon vorher aus; die Raumschleife ebenso.
2. **Über Zeit:** Abends (`evening`) und bei Batterie-Schutz gilt in der Raumschleife dasselbe Ziel (Min, Räume über dem
   Ziel aus). Räume, die per PV-Einspeisung Budget bekommen, wurden bisher vom Stop zuerst ausgeschaltet und dann wieder
   eingeschaltet – das entfällt. Ohne Leistungsbudget ändert sich nichts.
3. **Echte Daten:** 16.11. 09:02–09:18: Mit der Änderung wären die 8 Stop-Befehle (Büro, Haustür, Toilette, Wirtschaftsraum)
   entfallen; die Raumschleife hätte dieselben Räume bis 21,2 °C heizen lassen (Min-Vorrang), danach aus.

## Vorlauf aussetzen, wenn PV kommt – nachgerechnet, **nicht** umgesetzt

Auswertung seit Einführung Min-Vorrang (14.11. 19:00 – 16.11. 09:30), `room_temperature_samples`:

| | Wert |
|---|---|
| Heizstarts gesamt | 161 |
| davon schon **unter Min** gestartet (trotz Vorlauf 0,2 °C) | 82 (51 %), tiefster Start Kinder Bad 20,1 °C, sonst 20,7–20,9 °C |
| Abkühlung nahe Min (nicht heizend) | 0,3–0,9 °C/h je Raum (Toilette 0,88, Waschraum 0,67, Luis 0,66, Büro 0,60) |

Bei 0,6 °C/h ist der Vorlauf von 0,2 °C nach etwa 20 Minuten aufgebraucht. Ohne Vorlauf würden Räume regelmäßig unter Min
fallen – das widerspricht „Min darf nie unterschritten werden“. Gespart wird durch Warten nur, wenn PV-Überschuss innerhalb
dieser ~20 Minuten kommt; das Heizen bis Min wird sonst nur verschoben, nicht eingespart. Deshalb: Vorlauf bleibt.
Der Hinweis „Vorlauf senken“ wurde aus „Heizung jetzt“ (PR #67) wieder entfernt.
