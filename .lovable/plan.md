

# Dashboard-Warnung bei Quota-Erschöpfung prominent anzeigen

## Problem

Die `ApiErrorBanner` mit Quota-Warnung ist nur im Heizung-Tab sichtbar. Wenn der User auf dem Haupt-Dashboard ist, sieht er die kritische Warnung nicht.

## Lösung

### Änderung 1: ApiErrorBanner auf Index-Seite einbinden
- `src/pages/Index.tsx`: `ApiErrorBanner` importieren und **oberhalb der Tabs** platzieren, damit die Warnung auf jeder Tab-Ansicht sichtbar ist
- Optional mit Filter: Nur `quota_exhausted` und `token_expired` Fehler auf der Hauptseite anzeigen (nicht jeden einzelnen Offline-Fehler)

### Änderung 2: Quota-Warnung visuell prominenter gestalten
- `src/components/heating/ApiErrorBanner.tsx`: Bei `quota_exhausted` einen auffälligeren Stil verwenden:
  - Roter Rand mit Animation (pulse-Effekt)
  - Grössere Schrift für die Hauptwarnung
  - Klarer Hinweis auf Tages- vs. Monats-Quota mit Info welches Limit erreicht wurde
  - "Nicht schliessbar" machen bei Quota-Fehler (X-Button ausblenden), da die Warnung kritisch ist

### Betroffene Dateien
1. `src/pages/Index.tsx` — Import + Platzierung oberhalb der Tabs
2. `src/components/heating/ApiErrorBanner.tsx` — Prominenterer Quota-Stil, Pulse-Animation

