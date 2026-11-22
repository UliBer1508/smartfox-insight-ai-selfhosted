# Planer mit HiGHS als Prüfstein (22.11.2026)

**Uli, 22.11.2026:**
- „Dann ist immer noch die Frage, warum die KI-Steuerung keine Verbesserung erzielen kann. Ist der Algorithmus nicht gut genug?“
- „Warum verbessern wir unseren Algorithmus nicht um dieses HiGHS-Modell?“
- „So loslegen, prüfe vorher alle Dokus und Source-Code.“ – „Also spielen wir den Code in Österreich ein.“

## Ausgangslage
- Unser Planer (`heizplaner/modell.ts`, `plane`) sucht **gierig**: schaltet je Schritt die halbe Stunde und den Raum zu,
  die die Kosten am meisten senken, nimmt nichts zurück (danach ein Aufräum-Durchgang).
- EMHASS (lineare Optimierung mit HiGHS) war am Sonnentag 16.11. gleichauf mit den Regeln, unser Planer 7 kWh schlechter.
- Vermutung: Die Suche ist die Schwäche → gleiche Aufgabe mit HiGHS (vollständige Optimierung) rechnen.

## Umsetzung: `heizplaner/highs.ts` – `baueLp()`
Dieselbe Aufgabe wie `plane()` als gemischt-ganzzahliges lineares Problem (MILP), CPLEX-LP-Format:

| Teil | wie in plane() |
|---|---|
| Raummodell | Estrich S + Luft T, 15-min-Schritte, exakt `schritt()` (Sonne s·PV, innere Wärme c) |
| Entscheidung | je Raum und halbe Stunde: Netz-Heizen `hn` oder PV-Heizen `hp` (binär), feste Räume wie vorgegeben |
| Kosten | Netz − Einspeisefaktor·Einspeisung; Strafen Normal (0,6), Min (2 + 30), über PV-Max (0,2) × Raumgewicht; Restladung 0,9; Restwärme asymmetrisch (0,9 / 0,26, Ausnahme „endet am/über Ziel“) |
| Regel „ohne PV nur bis Netzgrenze“ | `hn` nur, solange T ≤ Netzgrenze (Min bzw. Normal) + Spielraum 0,3 °C |
| Regel „PV-Heizen“ | `hp` nur, wenn PV − Grundlast − Heizen der anderen ≥ ½ Leistung des Raums |
| Sonnentag | PV lädt zuerst die Batterie bis heating_min_battery_soc (exakt, nicht mit dem Zwischenstand der Suche) |
| Leistungsgrenze | Heizen je Viertelstunde ≤ capW |
| Batterie | frei planbar; bewertet wird danach mit `bewerte()` (Fronius-Logik) wie alle anderen Pläne |

**Gegenprobe 22.11.2026** (gieriger Plan fest vorgegeben → gleiche Kosten?): wenig Sonne 137,61 = 137,61,
trüb 243,14 = 243,14 ✓. Sonnentag 51,83 statt 49,73 – die gierige Suche prüft die Batterie-Regel mit dem
Zwischenstand der Suche, HiGHS exakt; HiGHS ist hier die strengere, richtige Auslegung.

## Warum nicht in Supabase
Probe 22.11.2026 (Testtage, 12 Räume, 1.164 Ja/Nein-Entscheidungen):

| Testtag | gierig (Kosten) | HiGHS optimal | Rechenzeit HiGHS (nativ, 1 Kern) |
|---|---|---|---|
| Sonnentag | 49,7 | 50,3 | 112 s |
| wenig Sonne | 137,6 | 143,6 | 39 s |
| trüb | 243,1 | 250,3 | 72 s |

(vor der Korrektur der Restwärme-Ausnahme gerechnet). Supabase erlaubt ~2 s Rechenzeit; als WebAssembly noch langsamer.
→ Der Heizplaner baut nur das Problem (25–45 ms, 1,2 MB), **gelöst wird auf dem Österreich-PC** in der EMHASS-Brücke
(highspy kommt mit EMHASS), Zeitlimit 300 s, Abstand zum Optimum 0,5 %.

## Ablauf (täglich 03:45, Aufgabe „EMHASS Vergleich“)
1. EMHASS (doc/EMHASS-VERGLEICH-2026-11-22.md)
2. `highs_eingabe tag=…` → LP des Vortags (gleiche Daten wie die Gegenrechnung) → highspy → `highs_bewerten`
   (Werte der Heizvariablen) → bewertet mit `bewerte()` → `heizplan_vergleich.planer_highs` (SQL 53)
3. Anzeige: Gegenrechnung in „Wo stehen wir?“, Spalte „Netz KI mit HiGHS“

## Was wir daraus lernen wollen
- Liegt „KI mit HiGHS“ an echten Tagen deutlich unter „KI“ (gierig) → die Suche ist die Schwäche → bessere Suche in
  den Planer (z. B. HiGHS auf dem PC für den Tagesplan, Planer in der Cloud führt nach).
- Liegen beide gleich, aber über den Regeln (16.11.) → nicht die Suche, sondern **Kostenrechnung/Gewichte, Regeln oder
  PV-Vorhersage** sind die Ursache → dort ansetzen (Analyse 16.11. offen).
- Der Planer in der Cloud bleibt bis dahin unverändert (gierig).

## Dateien
- `supabase/functions/heizplaner/highs.ts` – `baueLp`, `heizenAusLoesung`
- `supabase/functions/heizplaner/index.ts` – Aktionen `highs_eingabe`, `highs_bewerten`
- `supabase/SQL/53_planer_highs.sql` – Spalte `planer_highs` (ausgeführt 22.11.2026)
- `emhass/emhass_bruecke.py` – `highs_tag()`
- `src/components/ki/KiGegenRegeln.tsx` – Spalte „Netz KI mit HiGHS“
