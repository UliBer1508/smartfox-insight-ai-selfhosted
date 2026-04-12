

# Lösungskonzept: Sequentielles 2-Phasen-Heizen

## Das Problem

Die aktuelle Logik versucht in **einer einzigen Schleife** für jeden Raum individuell zu entscheiden ob eco oder komfort — mit einer Batterie-Bedingung (>=95%) als Voraussetzung für Komfort. Das führt dazu, dass bei 6.57kW Export kein Raum auf Komfort geschaltet wird, weil:

1. **Budget = nur gridExport** (ohne bereits heizende Räume)
2. **Komfort braucht Batterie >=95%** (irrelevant bei hohem Export)
3. **Kein 2-Phasen-Ansatz** — es gibt keinen "erst alle auf eco, dann alle auf komfort" Zyklus

## Die neue Logik

```text
Phase 1: ECO-Runde (Priorität 1→12)
─────────────────────────────────────
  verfügbar = gridExport + Σ(bereits heizende Räume)
  
  Für jeden Raum nach Priorität:
    Ist Raum < eco_temp?
      → JA: Passt Heizleistung ins verbleibende Budget?
        → JA: Setze auf eco_temp, ziehe Leistung vom Budget ab
        → NEIN: Überspringe (kein Budget mehr)
      → NEIN: Raum ist bereits ≥ eco, weiter

Phase 2: KOMFORT-Runde (Priorität 1→12)
────────────────────────────────────────
  Nur wenn Phase 1 komplett + noch Budget übrig
  
  Für jeden Raum nach Priorität:
    Ist Raum < comfort_temp?
      → JA: Passt Heizleistung ins verbleibende Budget?
        → JA: Setze auf comfort_temp, ziehe Leistung vom Budget ab
        → NEIN: Überspringe
      → NEIN: Raum ist bereits ≥ comfort, weiter

Phase 3: SUPER-KOMFORT (optional, wie bisher)
──────────────────────────────────────────────
  Nur wenn alle Räume ≥ comfort + noch Budget übrig
```

## Konkrete Änderungen

### Datei: `supabase/functions/pv-automation/index.ts`

**1. Budget-Berechnung korrigieren (Zeilen 920-936)**

```
// NEU: Budget = gridExport + Leistung aller bereits heizenden Räume + Toleranz
const currentlyHeatingPower = rooms
  .filter(r => r.is_heating)
  .reduce((sum, r) => sum + (r.calculated_power_w || r.heating_power_w || 800), 0);

const dynamicTolerance = Math.max(powerBudgetTolerance, Math.round(gridExport * 0.20));
availableBudget = gridExport + currentlyHeatingPower + dynamicTolerance;
```

Begründung: Wenn Büro mit 900W heizt, erscheinen diese 900W nicht mehr im gridExport. Das tatsächlich verfügbare PV-Budget ist aber gridExport + 900W.

**2. 4-Stufen-Logik durch 2-Phasen-Ansatz ersetzen (Zeilen 1017-1070)**

Statt einer einzigen Budget-Schleife zwei Durchläufe:

- **Phase 1 (Eco):** Alle Räume nach Priorität durchlaufen. Wenn `current_temp < eco_temp - 0.3` und Budget reicht → `allowedToHeat = true, targetLevel = 'eco'`
- **Phase 2 (Komfort):** Restliches Budget nehmen, alle Räume erneut durchlaufen. Wenn `current_temp < comfort_temp - 0.3` und Budget reicht → `allowedToHeat = true, targetLevel = 'comfort'`

Keine Batterie-Bedingung mehr für Komfort. Die einzige Bedingung ist: **Reicht der PV-Export für die Heizleistung dieses Raums?**

**3. Batterie-Gate für Komfort entfernen (Zeile 1630)**

Die Zeile `&& batteryFull` wird entfernt. Wenn genug gridExport da ist, wird auf Komfort geschaltet — unabhängig vom Batterie-Stand. Der Strom ist da und geht sonst verloren.

**4. PV-Priority-Calls auf 6 erhöhen**

Damit bei Quota-Knappheit mehr Räume profitieren.

## Erwartetes Verhalten

Bei 6.57kW Export + 12 Räume:

```text
Budget = 6570W (Export) + 900W (Büro heizt) + 1494W (Toleranz) = ~8964W

Phase 1 (Eco):
  Bad Uli (600W)    → eco ✓  Budget: 8364W übrig
  Zimmer Uli (1200W)→ eco ✓  Budget: 7164W übrig
  Luis (1000W)      → eco ✓  Budget: 6164W übrig
  ... alle 12 Räume → eco ✓  Budget: ~1464W übrig

Phase 2 (Komfort):
  Bad Uli (600W)    → komfort ✓  Budget: 864W übrig
  Zimmer Uli (1200W)→ komfort ✗  kein Budget
  ... Rest wartet bis Bad Uli fertig ist
```

Beim nächsten Zyklus (2 Min später) ist Bad Uli evtl. fertig → Zimmer Uli bekommt Budget.

## Betroffene Datei
- `supabase/functions/pv-automation/index.ts`

