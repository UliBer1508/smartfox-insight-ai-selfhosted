

# Plan: Budget-Logik korrigieren - Kein Netzheizen bei wenig PV

## Problem-Zusammenfassung

### Aktuelle Situation (Screenshot)
| Raum | Aktuell | Ziel | PV-Automatik | Problem |
|------|---------|------|--------------|---------|
| Zimmer Uli | 22.7°C | 22°C | "Komfort" | Wird geheizt obwohl PV nur 430W! |

### Energie-Daten jetzt
- PV-Leistung: **430W**
- Netzverbrauch: **~2.6 kW** (Heizungen laufen!)
- Batterie: **4.6%** (leer)

### Root-Cause: Fehlerhafte Budget-Logik

Zeilen 607-616 in `pv-automation/index.ts`:

```typescript
if (powerBudgetEnabled) {
  if (pvPower > 500) {
    // PV-Optimiert
    budgetMode = 'pv_optimized';
    availableBudget = pvPower - baseLoad + tolerance;  // OK
  } else {
    // Netz-Sequenziell: erlaubt 2000W aus dem NETZ!
    budgetMode = 'grid_sequential';
    availableBudget = maxGridHeatingPower;  // = 2000W ← PROBLEM!
  }
}
```

**Interpretation:** Bei wenig PV (< 500W) schaltet das System auf "Netz-Heizen" mit 2000W Budget.

**Ergebnis:**
- PV = 430W → Budget = 2000W
- Zimmer Uli (1200W) + Flur (700W) = 1900W < 2000W → "Aktiviert"
- Heizungen laufen mit **Netzstrom**!

---

## Die richtige Logik

### Was der Benutzer will
1. **Bei PV-Überschuss**: Mit PV heizen, Budget = PV-Leistung
2. **Bei wenig/kein PV**: NICHT heizen, nur Grundtemperatur halten

### Was die Logik macht
1. **PV > 500W**: "pv_optimized" → Budget = PV (korrekt)
2. **PV < 500W**: "grid_sequential" → Budget = 2000W (FALSCH!)

---

## Lösung

### Option A: Bei wenig PV auf Nacht-/Eco-Temperatur (empfohlen)

Wenn kein ausreichender PV-Überschuss vorhanden ist, sollte das System:
- Keine aktiven Heizzyklen starten
- Thermostate auf Eco-Temperatur (19°C) oder niedriger halten
- Nicht mit Netzstrom heizen

```typescript
// VORHER (Zeilen 607-616):
if (powerBudgetEnabled) {
  if (pvPower > 500) {
    budgetMode = 'pv_optimized';
    availableBudget = Math.max(0, pvPower - baseLoad + powerBudgetTolerance);
  } else {
    budgetMode = 'grid_sequential';
    availableBudget = maxGridHeatingPower;  // 2000W aus Netz erlaubt!
  }
}

// NACHHER:
if (powerBudgetEnabled) {
  if (pvPower > 500) {
    // PV-Optimiert: Mit PV heizen
    budgetMode = 'pv_optimized';
    availableBudget = Math.max(0, pvPower - baseLoad + powerBudgetTolerance);
  } else {
    // Zu wenig PV: KEIN aktives Heizen, nur Grundtemperatur halten
    budgetMode = 'grid_sequential';
    availableBudget = 0;  // KEIN Budget für aktives Heizen!
    console.log(`[PV-Automation] Wenig PV (${pvPower}W) - kein aktives Heizen`);
  }
}
```

### Option B: Minimales Budget für Frostschutz

Falls zumindest ein Raum auf Mindesttemperatur gehalten werden soll:

```typescript
} else {
  budgetMode = 'grid_sequential';
  // Nur 500W Budget für Frostschutz, nicht 2000W für Komfort!
  availableBudget = 500;
}
```

---

## Dateiänderungen

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | Zeilen 612-616: `availableBudget = maxGridHeatingPower` auf `availableBudget = 0` ändern |

---

## Erwartetes Ergebnis nach Fix

### Bei PV = 430W (aktuell):
```text
VORHER:
- budgetMode: grid_sequential
- availableBudget: 2000W
- Zimmer Uli: 22°C (heizt mit Netzstrom!)
- Flur: 20°C (heizt mit Netzstrom!)
- Netzbezug: ~2.6 kW

NACHHER:
- budgetMode: grid_sequential
- availableBudget: 0W
- Zimmer Uli: Budget-Pause → 15°C (stoppt!)
- Flur: Budget-Pause → 15°C (stoppt!)
- Netzbezug: ~360W (nur Grundlast)
```

### Bei PV = 3000W (Sonnenschein):
```text
- budgetMode: pv_optimized
- availableBudget: 3000 - 500 + 200 = 2700W
- Zimmer Uli: Aktiviert (1200W)
- Wohnzimmer: Aktiviert (2400W) → 1200+2400 > 2700 → Rotation
- Netzbezug: ~0W
```

---

## Alternative: `max_grid_heating_power_w` nur für Nacht nutzen

Falls du manchmal absichtlich mit Netzstrom heizen möchtest (z.B. wenn Batterie voll und Tarif günstig), könnte die Logik erweitert werden:

```typescript
if (pvPower > 500) {
  budgetMode = 'pv_optimized';
  availableBudget = pvPower - baseLoad + tolerance;
} else if (batterySoc > 80 && localHour >= 22) {
  // Nacht-Modus: Nutze Batterie/Netz
  budgetMode = 'grid_sequential';
  availableBudget = maxGridHeatingPower;
} else {
  // Tagsüber ohne PV: Nicht heizen
  budgetMode = 'grid_sequential';
  availableBudget = 0;
}
```

Aber für jetzt ist die einfache Lösung am besten: **Kein Budget bei wenig PV.**

---

## Zusammenfassung

Die aktuelle Logik interpretiert "grid_sequential" als Erlaubnis, mit 2000W aus dem Netz zu heizen. Das führt dazu, dass Räume wie "Zimmer Uli" auf 22°C geheizt werden, obwohl nur 430W PV verfügbar sind.

**Fix:** Bei PV < 500W das Budget auf 0 setzen, damit alle Räume auf die Stopp-Temperatur (15°C) gehen und nicht autonom heizen.

