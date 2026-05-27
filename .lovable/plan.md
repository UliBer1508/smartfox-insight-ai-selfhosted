## Ziel

Die drei Karten **Batterie-Status**, **PV-Leistung** und **Verbrauch** unterhalb der Energiefluss-Anzeige auf der Startseite entfernen. Dieselben Werte (SOC, PV-Leistung, Verbrauch, Batterie-Lade-/Entladeleistung) werden bereits im `EnergyFlowDiagram` direkt darüber dargestellt — die Wiederholung verbraucht nur Platz.

## Änderung

Datei: `src/pages/Index.tsx` (Zeilen 133–143)

Entfernen:
- `<BatteryStatus … />`
- den `grid grid-cols-2`-Block mit `<PowerStats />` und `<ConsumptionStats />`

Außerdem die nicht mehr benötigten Imports (Zeilen 13, 15, 16) entfernen:
- `BatteryStatus`
- `PowerStats`
- `ConsumptionStats`

Die Komponenten-Dateien selbst (`BatteryStatus.tsx`, `PowerStats.tsx`, `ConsumptionStats.tsx`) bleiben unangetastet — `BatteryStatus` wird weiterhin im `HeatingDashboard` verwendet, die beiden anderen sind dann ungenutzt, werden aber zunächst nicht gelöscht (falls du sie woanders wieder einbauen willst, sag Bescheid und ich räume sie weg).

## Nicht-Ziel

- Kein Eingriff in `EnergyFlowDiagram` selbst.
- Keine Änderungen an Heizungs-Dashboard, Backend, Polling oder PWA.

## Ergebnis

Linke Spalte zeigt nur noch den Energiefluss; rechte Spalte (Statistiken, Charts, aktive Verbraucher) bleibt unverändert. Die Seite wird kompakter und es gibt keine doppelten Live-Werte mehr.
