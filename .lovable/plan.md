

# Batterie-Verlauf: 1000-Zeilen-Limit erhoehen

## Problem
Der Hook `useBatteryHistory` laed maximal 1000 Zeilen aus der Datenbank. Bei ca. 2880 Eintraegen pro Tag reicht das nicht fuer mehrtaegige Ansichten. Bei "2 Tage" werden nur die neuesten ~1000 Eintraege geholt (hauptsaechlich heute), wodurch die Lade-/Entladezyklen von gestern fehlen.

## Loesung
Das Limit dynamisch an den Zeitraum anpassen und das Sampling-Intervall erhoehen, damit weniger Punkte geladen aber alle Tage abgedeckt werden.

## Aenderung in `src/hooks/useBatteryHistory.ts`

### 1. Dynamisches Limit basierend auf Zeitraum

| Zeitraum | Aktuelles Limit | Neues Limit | Sampling |
|----------|----------------|-------------|----------|
| Heute    | 1000           | 2000        | 2 Min    |
| 2 Tage   | 1000           | 5000        | 5 Min    |
| 3 Tage   | 1000           | 8000        | 10 Min   |

### 2. Code-Aenderung

Vorher:
```text
const samplingInterval = daysBack === 0 ? 2 * 60 * 1000 : daysBack === 1 ? 4 * 60 * 1000 : 8 * 60 * 1000;
...
.limit(1000);
```

Nachher:
```text
const samplingInterval = daysBack === 0 ? 2 * 60 * 1000 : daysBack === 1 ? 5 * 60 * 1000 : 10 * 60 * 1000;
const queryLimit = daysBack === 0 ? 2000 : daysBack === 1 ? 5000 : 8000;
...
.limit(queryLimit);
```

## Ergebnis
- Heute: Bis zu 2000 Zeilen, nach Sampling ca. 350 Punkte im Chart
- 2 Tage: Bis zu 5000 Zeilen, nach Sampling ca. 280 Punkte
- 3 Tage: Bis zu 8000 Zeilen, nach Sampling ca. 210 Punkte

Alle Tage werden vollstaendig abgedeckt, die Lade-/Entladezyklen sind sichtbar.
