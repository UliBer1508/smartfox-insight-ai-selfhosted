## Ziel
Auf dem Desktop entsteht im Dashboard ein großer leerer Bereich, weil die linke Spalte (Energiefluss‑Diagramm) viel kürzer ist als die rechte Spalte (Statistiken + Gate‑Verlauf + Leistungsverlauf). Der Leistungsverlauf soll künftig über die **volle Breite** unter dem oberen Bereich stehen.

## Neues Layout (nur Desktop, Mobile bleibt gleich)

```text
┌───────────────────────────────────────────────┐
│  Verbindung / KI-Vorschlag / Automations-Status │  (volle Breite, unverändert)
├──────────────────────┬────────────────────────┤
│  Energiefluss        │  Statistiken           │
│  (Netz/Batterie)     │  + Gate-Verlauf        │
├──────────────────────┴────────────────────────┤
│  Leistungsverlauf  (volle Breite)              │
├───────────────────────────────────────────────┤
│  Batterie-Verlauf  (volle Breite, unverändert) │
└───────────────────────────────────────────────┘
```

- Oberer Bereich: 2 Spalten (`lg:grid-cols-2`) – links Energiefluss‑Diagramm, rechts Statistiken + Gate‑Verlaufskarte. Dadurch sind beide Spalten ähnlich hoch.
- Der **Leistungsverlauf (`EnergyChart`)** wandert aus der rechten Spalte heraus und steht darunter über die ganze Breite. Mehr horizontaler Platz = bessere Lesbarkeit der Kurve.
- Auf Mobile (`< lg`) stapeln sich wie bisher alle Karten untereinander – keine sichtbare Änderung.

## Technische Umsetzung
- Datei: `src/pages/Index.tsx`, Block `activeTab === 'dashboard'` (Zeilen ~115–146).
- `grid lg:grid-cols-3` → `grid lg:grid-cols-2`; linke Spalte `lg:col-span-1` (Energiefluss), rechte Spalte `lg:col-span-1` (EnergyStats + BatterySocHistoryCard).
- `EnergyChart` aus der rechten Spalte entfernen und als eigenständiges Element direkt nach dem Grid (vor `BatteryHistoryChart`) über volle Breite rendern.
- Keine Logik-, Hook- oder Datenänderungen; reine Layout-/Markup-Anpassung.
