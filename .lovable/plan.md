

## Befund

Im `BatteryHistoryChart` (Tab "Heute") gibt es unterhalb des Diagramms eine Slider/Progress-Bar, die immer auf 100% ("Jetzt") steht. Sinnlos, weil sie keinen Bezug zur Tageszeit hat.

## Lösung

Slider in eine **Tageszeit-Fortschrittsleiste** umwandeln: 0% = 00:00, 100% = 24:00, aktueller Füllstand = aktuelle Wiener Uhrzeit.

### Änderungen

**`src/components/energy/BatteryHistoryChart.tsx`**
- Bar-Wert berechnen aus `getViennaMinutesSinceMidnight() / 1440 * 100` (siehe `src/lib/dateUtils.ts`).
- Linke Beschriftung: `00:00`, rechte: `24:00`, Mitte/Label: aktuelle Uhrzeit (`getViennaTimeString()`) statt „Jetzt".
- Nur im Tab „Heute" anzeigen. Bei „2 Tage"/„3 Tage" Bar ausblenden (oder Beschriftung sinngemäß auf Zeitraum-Start/Ende setzen — Empfehlung: ausblenden, weil Tageszeit dort irreführend wäre).
- Auto-Update jede Minute via `setInterval`, damit die Bar mitläuft.

### Ergebnis

Bar zeigt um 08:50 ca. 37% Fortschritt durch den Tag, mit Label „08:50" mittig. Aktualisiert sich live.

