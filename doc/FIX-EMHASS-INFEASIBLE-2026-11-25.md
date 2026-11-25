# FIX: EMHASS „Infeasible“ und Meldung „EMHASS-Vergleich fehlt“ (25.11.2026)

Bezug: doc/EMHASS-VERGLEICH-2026-11-22.md, SQL 52.

## Anlass
Der Systemstatus meldete am 25.11. „Österreich-PC: EMHASS-Vergleich für gestern fehlt“. Laut `bruecke.log` ist die
Aufgabe um 03:45 aber gelaufen: Für den 24.11. hat HiGHS gerechnet, EMHASS war „ohne Lösung (Status Infeasible)“.
Seit dem 23.11. kam „Infeasible“ deutlich öfter vor (16., 18., 19., 20., 24.11.).

## Ursache (geprüft)
Die Infeasible-Tage sind genau die Tage, an denen **Toilette Eingang um Mitternacht unter Min (21 °C)** lag:

| Tag | Toilette Eingang 0:00 | EMHASS |
|---|---|---|
| 16.11. | 20,8 | Infeasible |
| 17.11. | 21,4 | Optimal |
| 18.11. | 20,3 | Infeasible |
| 19.11. | 20,3 | Infeasible |
| 20.11. | 20,3 | Infeasible |
| 21.11. | 21,1 | Optimal |
| 22.11. | 21,5 | Optimal |
| 23.11. | 21,4 | Optimal |
| 24.11. | 20,9 | Infeasible |

`emhassEingabe` setzte das harte Min je Raum auf einen festen Wert `min(Min, Start, Dauerzustand)`. Liegt der Raum schon
unter Min, ist das der Startwert (20,9 °C). EMHASS rechnet aber mit einer **Verzögerung** (`thermal_inertia`, bei
Toilette Eingang 2,5 h = 5 Schritte): In dieser Zeit kommt keine Wärme an, der Raum kühlt im Modell leicht ab
(20,9 → 20,875 °C). Der erste Schritt, in dem Heizen wirkt, bringt mit dem gelernten Modell nur +0,008 °C → 20,878 °C,
also unter dem Min von 20,9 °C → keine Lösung möglich.

Am 22.11. war das verdeckt: Damals hat die Prüfung „Dauerzustand“ das Min von Toilette Eingang auf 18–20 °C begrenzt.
Mit dem Modell ab 23.11. (k an der Untergrenze 0,0005, innere Wärme −10 °C) gilt der Dauerzustand als „haltbar“, die
Begrenzung fiel weg. Die Meldung „Min … begrenzt“ stand außerdem erst *nach* der Status-Prüfung im Protokoll und
fehlte deshalb an Infeasible-Tagen.

## Änderungen
1. **`supabase/functions/heizplaner/emhass.ts`** – neue Funktion `erreichbarMin`: rechnet EMHASS' eigenes Modell mit
   Dauerheizen ab Schritt 0 (erst nach der Verzögerung wirksam) und begrenzt das harte Min **je Schritt** auf diesen
   Verlauf − 0,05 °C. Grenzen werden auf 0,01 °C abgerundet (vorher auf 0,1 °C gerundet, das konnte nach oben runden).
   Ersetzt die alte Prüfung „Dauerzustand“ (`haltbar`), die darin enthalten ist. Der Wunsch (Normal/Min als weiches Ziel)
   bleibt unverändert; bewertet wird wie bisher mit unserem Raummodell, ein Unterschreiten von Min zählt dort in
   „unter Min °C·h“ – der Vergleich bleibt fair.
2. **`emhass/emhass_bruecke.py`** – Meldung „Min … begrenzt“ vor dem Rechnen; „Optimal (Relaxed)“ (EMHASS'
   Ausweichlösung, Ein/Aus stufenlos) wird mitbewertet, der Status bleibt in `heizplan_vergleich.emhass.status` sichtbar.
3. **SQL 57** (ersetzt den Block aus SQL 52 in `system_problems()`):
   - weder EMHASS noch HiGHS für gestern → „EMHASS-Vergleich für gestern ist nicht gelaufen“
   - Lauf da, aber EMHASS ohne Lösung → erst ein Problem, wenn das **2 Tage hintereinander** passiert

## Nebenwirkungen geprüft
- Wer liest die Daten: `emhass_eingabe` nutzt nur die Brücke; `emhass_bewerten` und „KI gegen Regeln“ unverändert.
  `min_begrenzt` wird jetzt auch gemeldet, wenn ein Raum schon unter Min startet (vorher nicht) – nur Protokolltext.
- Über die Zeit: Nach einem Infeasible-Tag ohne Lösung am Folgetag meldet der Status erst am 2. Tag; ein ausgefallener
  Lauf (PC aus, Schlüssel abgelehnt) wird wie bisher am selben Morgen gemeldet.
- Nachgerechnet mit den Werten vom 24.11. (Modell 25.11. 02:00): Toilette Eingang Min je Schritt 20,90 → 20,82 … 20,94 °C,
  mit Dauerheizen eingehalten; alle anderen Räume unverändert bei ihrem Min (Abstand zum erreichbaren Verlauf ≥ 0,05 °C).
- Offen (nicht Teil dieses Fixes): Das Modell von Toilette Eingang und Waschraum ist laut Prüfung vom 23.11. nicht
  plausibel (Aufheizen 0,017–0,028 °C/h). EMHASS plant deshalb dort mit einem zu schwachen Raum.

## Einspielen
1. PR mergen → `heizplaner` wird per GitHub-Aktion deployt.
2. SQL 57 im Projekt `pflnniklvqbwjwrjswaz` ausführen.
3. Österreich-PC: `cd C:\Heizung\repo; git pull` und `copy C:\Heizung\repo\emhass\emhass_bruecke.py C:\EMHASS\`.
4. Optional Nachtrag: `C:\EMHASS\nachrechnen.txt` mit `10` anlegen → der nächste Lauf rechnet die letzten 10 Tage neu.
