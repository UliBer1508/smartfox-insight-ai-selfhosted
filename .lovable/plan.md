

# Effizienz-basierte Raum-Sortierung implementieren

## Problem
Die Sortierung der Räume (Zeile 732-736) nutzt nur Priorität, Temperatur-Defizit und Wartezeit. Die vorhandenen `energy_per_degree_wh`-Daten aus `room_ml_features` werden ignoriert. Dadurch werden ineffiziente Räume (z.B. Wirtschaftsraum: 1781 Wh/°C, 153 Min für +1°C) vor effizienten Räumen (z.B. Zimmer Luis: 345 Wh/°C, 21 Min) aktiviert.

## Lösung

### In `pv-automation/index.ts` (Zeilen 700-736)

1. **ML-Features in `roomsWithPriority` einbinden**: Für jeden Raum die `energy_per_degree_wh` aus den bereits geladenen `latestMlFeatures` (Zeile ~600) nachschlagen und dem Objekt hinzufügen.

2. **Sortierung erweitern**: Nach gleicher Priorität und ähnlichem Temperatur-Defizit, Räume mit **niedrigerem** `energy_per_degree_wh` bevorzugen (schneller fertig → gibt Budget frei für nächsten Raum).

3. **Logging**: Pro Raum loggen: `[Raum] braucht ~X Wh für +Y°C, geschätzte Dauer: Z Min`

### Sortier-Reihenfolge (neu)
1. Priorität (1 vor 2 vor 3)
2. Temperatur-Defizit > 0.5°C Unterschied → größeres Defizit zuerst
3. **Effizienz**: niedrigeres `energy_per_degree_wh` zuerst (Räume die schnell fertig sind)
4. Wartezeit (längste zuerst, als Tiebreaker)

### Datei

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | ML-Features in Sortierung einbeziehen (Zeilen 700-736) |

Keine DB-Änderungen nötig — `latestMlFeatures` wird bereits geladen.

