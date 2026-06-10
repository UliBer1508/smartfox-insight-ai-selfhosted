# Kompakte Batterie-Gate-Verlauf-Anzeige

## Ziel
Die Karte „Verlauf — Batterie-Gate-Änderungen" wächst aktuell mit jeder neuen Zeile und verbraucht viel vertikalen Platz. Sie wird zu einer kompakten, einklappbaren Karte mit hart gedeckelter Höhe umgebaut.

## Umsetzung (nur Frontend)
Datei: `src/components/heating/AutomationStatusCards.tsx` → Funktion `BatterySocHistoryCard`.

### Eingeklappter Standardzustand (klein)
- Header mit Titel + Zähler-Badge (z. B. „14 Einträge").
- Darunter nur die **2 neuesten Einträge** als einzeilige, dichte Zeilen:
  `03.06. 10:05 · 55→50% · ●` (farbiger Status-Punkt statt großem Badge).
- Button/Chevron **„Alle anzeigen (N)"** klappt den Rest auf.

### Aufgeklappter Zustand (scrollbar, gedeckelt)
- Vollständige Liste (`history.slice(0, 30)`) in einem Container mit **`max-h-72 overflow-y-auto`** → Karte wächst nie unbegrenzt.
- Begründung pro Zeile **einzeilig mit `truncate`**; voller Text per **Tooltip** (`@/components/ui/tooltip`).

### Dichteres Layout
- Status als kleiner farbiger Punkt (grün = übernommen, grau = abgelehnt, gelb = offen) statt großem Badge.
- Zeitpunkt + Änderung kompakt in einer Zeile, Begründung gedimmt/gekürzt darunter (nur aufgeklappt).

## Technik
- `useState` für `expanded`-Zustand.
- Bestehendes `Tooltip`-Component für volle Begründung.
- Keine Schema-, Hook- oder Logik-Änderung; `useBatterySocSuggestions` bleibt unangetastet.
