# Auto-Steuerung › „Wo stehen wir?“ – aktuell, Woche/Monat/Jahr, Abgleich Rechnung (22.11.2026)

**Uli, 22.11.2026:**
- „Diese Zahlen werden scheinbar nicht upgedated.“
- „Ich möchte, dass die Daten täglich upgedated werden. Ich möchte sehen, wie sie sich ändern pro Woche, Monat, Jahr.“
- „Und ich möchte, dass du die Rechnung der Salzburg AG dazu vergleichst.“ (Verbrauchs- und Abrechnungsinfo Okt. 2026)

## Befund

| Was | Wann gerechnet | Problem |
|---|---|---|
| Strom/Kosten (`energie_tag`) | stündlich :07 (Cron `energie-verlauf`) für heute und gestern | **war aktuell** (20.11.: 127/40/87 € → 21.11.: 113/32/82 €) |
| Raumwerte, Außentemperatur (`tages_bewertung`) | Vortag um **09:55** (`nacht_protokoll_tick` → `tag_bewerten`) | bis dahin fehlte der Vortag, „Ø je Nacht/Tag“ wurde trotzdem durch 7 geteilt |
| Nacht unter Min (`tages_bewertung.nacht_min_unter`) | 09:55 | **Fehler:** Nacht ohne Unterschreitung wurde `NULL` statt `0` gespeichert (18., 19.11.) → Nächte fehlten |
| Gegenrechnung KI (`KiGegenRegeln`) | ~03:00 | nur beim Öffnen geladen; Text „5 von 3 Tagen in Folge“ |

## Änderungen

**SQL 48** (am 22.11.2026 ausgeführt)
- `tag_bewerten`: Nacht mit Messwerten und ohne Unterschreitung = 0. Nachtrag in `tages_bewertung` und `energie_tag`.
- `optimierung_woche`: Außentemperatur notfalls direkt aus `weather_data` (Vortag vor 09:55), liefert `tage_min`,
  `tage_normal` (Tage mit Raumwerten), `stand` (letzte Berechnung) und `bewertet_bis`.

**SQL 49** (`optimierung_woche` am 22.11. ausgeführt; Rest siehe „Offen“)
- `optimierung_woche`: Zeitraum bis 400 Tage (Jahr), Grundgebühr als `grund_eur`. `wochen` bleibt nur für die alte Anzeige.
- `optimierung_verlauf(einheit, bis, anzahl)`: Kennzahlen je Woche (Mo–So) oder Kalendermonat.
- Tabelle `stromrechnung` (Monatswerte Salzburg AG, RLS: lesen für angemeldete Nutzer) + `stromrechnung_abgleich()`.
  Eingetragen: Okt. 2026 (99,10 kWh, 32,16 €), Okt. 2025 (127,67 kWh, nur Menge).

**Anzeige** (`OptimierungView.tsx`, `KiGegenRegeln.tsx`)
- Zeitraum **Woche · Monat · Jahr** mit ◀ ▶ (Zeitlogik `verlaufZeit.ts` wie „Verlauf und Wirkung“). Start: die Woche
  von gestern; ein laufender Zeitraum zählt bis gestern und wächst jeden Tag.
- Jede Zahl mit Vergleich zur **Vorwoche/Vormonat/Vorjahr** – Summen **je Tag**, damit ein laufender Zeitraum fair
  verglichen wird; grün = besser, rot = schlechter.
- Ø je Nacht/Tag nur über Tage mit Raumwerten; Hinweis „Raumwerte für … folgen nach 10 Uhr“; „Stand … Uhr“.
- Verlauf: Woche/Monat → letzte 8 Wochen, Jahr → Monate des Jahres; je Balken Netzkosten je Tag.
- Neu: **„Stimmt das mit der Stromrechnung?“** – je Monat Rechnung gegen App (gemessen, Tage abgedeckt, hochgerechnet,
  ct je kWh inkl. Grundgebühr).
- Neu laden alle 10 min und beim Zurückkehren in den Tab (beide Komponenten).
- Gegenrechnung: „3 Tage in Folge gleich gut – es fehlt noch ein Sonnentag“ statt „5 von 3“.

## Abgleich Oktober 2026

| | Menge | Kosten | je kWh |
|---|---|---|---|
| Salzburg AG (Monatsinfo) | 99,10 kWh | 32,16 € (Energie 14,74 · Netz 13,77 · Abgaben 3,65) | 32,5 ct |
| App, 13.–31.10. (19 Tage) | 67,5 kWh | 20,18 € + 8,36 € Grundgebühr | |
| App rechnet mit | | 29,94 ct/kWh + 161,30 €/Jahr | |

- Die App hat erst ab 13.10. Daten – Oktober ist nicht voll vergleichbar. Erster voller Monat: **November 2026**.
- Für 99,10 kWh ergäbe die App-Rechnung ≈ 29,67 € + 13,70 € Grundgebühr = **43,37 €** statt 32,16 €. Grund: Die
  Monatsinfo enthält den **Strompreisdeckel** (−6,461 ct netto auf eine gedeckelte Menge) und die **Frei-Tage**, und die
  Netznutzung ist geschätzt (siehe SQL 36). Für die Steuerung bleibt der Preis der nächsten kWh (29,94 ct) richtig.

## Offen / Prüfen

- Teil 2 von SQL 49 (`optimierung_verlauf`, `stromrechnung`, `stromrechnung_abgleich`) – Ausführung am 22.11. wurde vom
  Supabase-Connector mit einer Rückfrage angehalten; prüfen mit `select stromrechnung_abgleich();`.
- Neue Monatsinfos der Salzburg AG eintragen (`insert into stromrechnung …`), sobald sie kommen.
- Nach November (01.12.): App-Netz-kWh gegen Rechnung; Abweichung > 5 % → Messung prüfen.

## Nachtrag 22.11.2026 – Vergleich nur, wenn die Vorperiode Daten hat

Nach dem Einspielen zeigte „Monat“ gegen Oktober Scheinsprünge (Heizung +6878 %, kWh je Heizgradtag +567 %): Der
Oktober hat erst ab 13.10. Daten, Heizstrom erst ab 29.10. – Tage ohne Heizwert zählen als 0.
- Heizwerte (davon Heizung, kWh je Heizgradtag) werden nur verglichen, wenn die Vorperiode an ≥ 80 % ihrer Tage Heizstrom
  hat; sonst „Heizung erst an x von y Tagen gemessen – kein Vergleich“. Ebenso Min je Nacht (≥ 80 % der Nächte).
- Kopfzeile: „Vormonat: nur 18 von 31 Tagen (13.10.–31.10.)“.
- Ab dem Doppelten zeigt die Anzeige „×9“ statt „+772 %“. Diese Sprünge sind echt (Oktober kaum geheizt).
