

# Raum-Prioritäten in der Datenbank korrigieren

## Problem

Die aktuellen Prioritäten in der Datenbank weichen von der gewünschten Heiz-Reihenfolge ab:

| Raum | Ist-Prio | Soll-Prio |
|------|----------|-----------|
| Bad Uli | 1 | 1 |
| Zimmer Uli | 2 | 2 |
| Zimmer Luis | 3 | 3 |
| Zimmer Luca | 4 | 4 |
| Büro | 6 → | 5 |
| Wohnzimmer | 7 → | 6 |
| Kinder Bad | 5 → | 7 |
| Flur | 8 | 8 |
| Haustür | 7 | 8 |
| Toilette Eingang | 7 | 8 |
| Waschraum | 7 | 8 |
| Wirtschaftsraum | 7 | 8 |

## Änderung

**Datenbank-Migration:** UPDATE-Statements für die 6 Räume deren Priorität sich ändert (Büro 6→5, Wohnzimmer 7→6, Kinder Bad 5→7, Haustür/Toilette/Waschraum/Wirtschaftsraum 7→8).

Der Code in `RoomStatusTable.tsx` sortiert bereits korrekt nach Priorität — es sind nur die DB-Werte falsch.

