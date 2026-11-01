# Konzept: Lernschleife – wie Erkenntnisse in die Steuerung kommen

**Stand:** 1. November 2026 · **Status:** FREIGEGEBEN (Uli, 01.11.2026: „Lernschleife umsetzen, Konzept im Repo
speichern, alle Dokus nachziehen“) – Stufe 1 und 2 umgesetzt, Stufe 3 als Vorstufe, Stufe 4 offen
**Supabase:** `pflnniklvqbwjwrjswaz` · **SQL:** `supabase/SQL/14_lernschleife.sql`
**Baut auf:** `KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md` (Grundregeln), `TEST-NACHTWERT-2026-11-01.md`
(Nacht-Protokoll), `PROTOKOLL-MODUL-2026-11-01.md`

---

## 1. Warum die KI bisher nichts Brauchbares gelernt hat

| # | Ursache | Folge |
|---|---|---|
| 1 | **Falsche Daten:** Bis 24.10.2026 regelten die Thermostate im Modus „auto“ nach ihrem eigenen Wochenprogramm; „heizt“ war immer „nein“; Heizzyklen erst seit 26.10. | `learned_policies`, Rewards und Heiz-Kennzahlen im Mustergedächtnis beschreiben das Wochenprogramm, nicht unsere Entscheidungen |
| 2 | **Kaum Hebel:** KI verschiebt nur die Wartetag-Schwelle (±0,3) und gibt einen Vorheiz-Bonus | Batterie-Grenze, Untergrenzen, Reihenfolge, Zeitpunkt – nie gelernt |
| 3 | **Falsches Ziel:** Reward bestraft nur Netzbezug | „Batterie gehört der Nacht“, „Sonne zuerst in die Batterie“ kamen nicht vor |
| 4 | **Keine Rückmeldung:** Ob ein Tag gut lief, wurde nicht gemessen | kein Lernen aus Ergebnissen |
| 5 | **Messfehler:** Thermostate regeln auf Soll + 0,7 °C; zwei Räume ohne Heizleistung | Energie je Raum und Zielerreichung verfälscht |

## 2. Grundsatz

Die Grundregeln bleiben immer und werden von der KI **nie** aufgehoben: Batterie gehört der Nacht · Sonne zuerst
in die Batterie (Ladestand-Grenze ohne Ausnahme) · Untergrenze als Sicherheit · Steuerung nur über die Thermostate.
Die KI optimiert **innerhalb** dieser Regeln und wird an **Ulis Zielen** gemessen. Jeder Vorschlag hat eine
nachprüfbare Begründung; übernommen wird er von Uli. Gesperrte Parameter (`LOCKED_PARAMS`) bleiben gesperrt.

## 3. Die vier Stufen

| Stufe | Inhalt | Stand |
|---|---|---|
| **1. Saubere Daten** | `system_settings.learning_data_since = 2026-10-26`; `update-learned-policies` lernt nur ab diesem Tag; `learned_policies` geleert (Neuaufbau nachts). **Altdaten gelöscht** (Uli 01.11.: „löschen, damit keine Falschberechnung erfolgt“, SQL `15_altdaten_loeschen.sql`): `learning_events`, `room_ml_features`, `room_heating_logs` vor 26.10., Heiz-Kennzahlen in `daily_pattern_scores` vor 26.10., berechnete Raumwerte (Leistung, Wärmeverlust, Solargewinn). Behalten: Energie, PV, Prognosen, Wetter, Temperaturen. Test DP 19, Heizleistung Haustür/Toilette eintragen | umgesetzt 01.11. (DP 19 / Leistung: Uli) |
| **2. Tagesnote nach Ulis Zielen** | Tabelle `tages_bewertung`: je Tag Einstellungen (21:55) + Ergebnis (nächster Morgen 09:55), Note 0–100 | umgesetzt 01.11. |
| **3. Vorschläge aus ähnlichen Tagen** | Mustergedächtnis sucht ähnliche Tage (Prognose, Außentemperatur, Batterie) und nimmt die Einstellungen des Tages mit der besten Note als Vorschlag – mit Begründung | Vorstufe: Batterie-Vorschlag nennt bereits den bestbewerteten ähnlichen Tag und seine Grenze; echte Vorschläge ab ~2 Wochen Tagesnoten |
| **4. Ergebnis prüfen** | Am Tag danach automatisch Vorschlag gegen Note vergleichen, im Tab KI zeigen; erst nach Wochen guter Ergebnisse innerhalb fester Grenzen selbst wirken lassen | offen |

## 4. Tagesnote (Stufe 2)

Je Teil 0–25 Punkte, Summe = Note (Funktion `tag_bewerten`):

| Teil | Frage | Berechnung |
|---|---|---|
| ① **Nacht** | Hat die Batterie bis zum Morgen gereicht? | Ladestand morgens ≥ 8 % → 25; sonst 25 × (Ladestand bei Sonnenuntergang − 5) / (Nachtbedarf + 15), bei leerer Batterie am Morgen höchstens 12,5 |
| ② **Sonne** | Wurde die PV im Haus genutzt? | 25 × (PV − Einspeisung) / PV; unter 1 kWh PV = 25 |
| ③ **Komfort** | Lagen Räume unter ihrer Untergrenze? | 25 × (1 − Raum-Minuten unter Untergrenze / (Räume × Minuten 08–22 Uhr)) – Korrektur 01.11. (SQL 16): vorher gegen 720 Minuten eines einzigen Raums gerechnet, daher immer 0 |
| ④ **Netz** | Wie viel Netzstrom ging in die Heizung? | 25 × (1 − Heizung aus Netz kWh / 5) |

Weitere Spalten: PV, Verbrauch, Einspeisung, Netz, Heizung gesamt und nach Quelle (PV/Batterie/Netz),
Ladestand bei Sonnenuntergang und am Morgen, gemessener Nachtbedarf, Außentemperatur, Prognose, Hinweise
(„Batterie vor dem Morgen leer“, „… kWh Heizung aus Batterie“ …), Einstellungen (Grenzen, Nachtmodus,
Räume mit Priorität und Untergrenze/Eco/Komfort).

Ablauf im Cron `nacht-protokoll` (stündlich, Wiener Zeit): 21:55 `tag_einstellungen_merken`, 09:55
`nacht_auswerten` + `tag_bewerten` (Vortag). Jede Note steht auch im Protokoll (Ereignisse › Einstellungen).
Nachgetragen für 26.–31.10., soweit Energiedaten noch da sind (7 Tage).

Die Gewichte sind ein Startpunkt. Wenn die Noten Ulis Gefühl für einen guten/schlechten Tag nicht treffen,
werden sie hier angepasst (nicht im Code verstecken).

## 5. Anzeige

Tab **Protokoll › Tagesnoten**: Note farbig, vier Teilnoten, PV, Heizung, Batterie Sonnenuntergang → Morgen,
Grenze des Tages, Hinweise; Zeile antippen → Details und Raum-Einstellungen.

## 6. Prüfen

- 02.11. 09:55: erste echte Tagesnote (01.11.) – im Protokoll und unter Tagesnoten.
- Nach einer Woche: Passen die Noten zu Ulis Einschätzung der Tage? Sonst Gewichte (§4) anpassen.
- Nach ~2 Wochen: Stufe 3 – Vorschläge aus den besten ähnlichen Tagen.
