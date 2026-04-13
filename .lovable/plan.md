

## Analyse: Warum wird Batteriestrom für Heizung verwendet?

### Aktuelle Situation (08:10 UTC / 10:10 Wien)

| Wert | Messung |
|------|---------|
| PV-Produktion | ~1700W |
| Batterie-SOC | **11%** (kritisch!) |
| Batterie-Power | +550W (lädt, aber langsam) |
| Grid (power_io) | ~0W |
| Consumption | ~2200W |

### Was passiert

Die Automation vergibt ein **Prognose-Budget von 1539W** für Eco-Heizung, obwohl der Grid-Export **0W** beträgt:

```text
PV (1700W)
├── Grundlast:    ~500W
├── Batterie-Ladung: ~550W (bei 11% SOC!)
└── Heizung (Budget): Bad Uli 600W + Büro 900W = 1500W
    ──────────────────
    SUMME:           ~2550W > 1700W PV
    → Fehlende ~850W kommen vom Netz oder Batterie stoppt Ladung
```

Die Batterie lädt nur mit ~550W statt mit voller Leistung (~3000W möglich), weil die Heizung den PV-Strom "stiehlt".

### Ursache im Code (Zeilen 1050-1058)

Das `forecastMinBudget` berechnet: `Stunden-Prognose (2039W) - Grundlast (500W) = 1539W`

**Problem:** Dieses Budget ignoriert den Batterie-Ladebedarf komplett. Es wird nicht geprüft:
- Wie voll ist die Batterie?
- Wie viel PV-Leistung braucht die Batterie zum Laden?
- Sollte die Batterie bei 11% SOC Priorität haben?

Der Batterie-Schutz (Zeile 1062) greift nur wenn `batteryPower < 0` (Entladung). Wenn die Batterie lädt (+550W), wird nichts abgezogen — aber die Heizung verhindert, dass die Batterie schneller laden kann.

### Lösung

**Datei: `supabase/functions/pv-automation/index.ts`** — Zeilen 1048-1074

Batterie-Ladebedarf vom Prognose-Budget abziehen, wenn SOC niedrig ist:

```typescript
// Nach Zeile 1048 (baseBudget Berechnung):

// Batterie-Ladereserve: Bei niedrigem SOC PV-Kapazität für Batterie reservieren
if (batteryPower > 0 && batterySoc < 80) {
  // Batterie lädt gerade — diese Leistung vom Budget abziehen
  // Bei SOC < 30%: volle Ladeleistung reservieren
  // Bei SOC 30-80%: anteilig reduzieren
  const batteryPriority = batterySoc < 30 ? 1.0 : (80 - batterySoc) / 50;
  const batteryReserve = Math.round(batteryPower * batteryPriority);
  baseBudget = Math.max(0, baseBudget - batteryReserve);
  console.log(`[PV-Automation] 🔋 Batterie-Ladereserve: ${batteryReserve}W abgezogen (SOC ${batterySoc}%, lädt ${Math.round(batteryPower)}W, Priorität ${(batteryPriority*100).toFixed(0)}%) → Budget ${Math.round(baseBudget)}W`);
}
```

**Gleiche Logik auch für `grid_sequential` Modus** (Zeile 1088-1094):

```typescript
// availableBudget ebenfalls um Batterie-Ladereserve reduzieren
if (batteryPower > 0 && batterySoc < 80) {
  const batteryPriority = batterySoc < 30 ? 1.0 : (80 - batterySoc) / 50;
  const batteryReserve = Math.round(batteryPower * batteryPriority);
  availableBudget = Math.max(0, availableBudget - batteryReserve);
}
```

### Auswirkung

Bei aktuellem Zustand (SOC 11%, Batterie lädt 550W):
- `batteryPriority` = 1.0 (SOC < 30%)
- `batteryReserve` = 550W
- Neues Budget: 1539 - 550 = **989W**
- Nur **ein Raum** kann heizen (Bad Uli 600W oder Büro 900W), nicht beide gleichzeitig
- Die restlichen ~1100W PV gehen in die Batterie → schnellere Ladung

Bei SOC 60%: `batteryPriority` = 0.4, Reserve = 220W → mehr Budget für Heizung
Bei SOC 80%+: keine Reserve → volles Budget

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen 1048-1058 und 1088-1094

