

# Plan: Sequenzielles Heizen reparieren

## Problem-Zusammenfassung

### Aktuelle Situation
| Raum | Ziel-Temp | Heizt? | Power | Problem |
|------|-----------|--------|-------|---------|
| Wohnzimmer | 22°C | JA | 2400W | OK - hat Budget |
| Bad Uli | 22°C | JA | 600W | Nie pausiert! |
| Büro | 22°C | JA | 900W | Nie pausiert! |
| Wirtschaftsraum | 20°C | JA | 700W | Falsche Temp! |
| Zimmer Luca | 18°C | **JA** | 1000W | Heizt bei 18°C! |
| Zimmer Luis | 18°C | **JA** | 1000W | Heizt bei 18°C! |
| Kinder Bad | 18°C | **JA** | 500W | Heizt bei 18°C! |
| Waschraum | 18°C | **JA** | 600W | Heizt bei 18°C! |

**Geschätzte Heizleistung: ~7.7 kW** - erklärt die 2.3 kW Netzbezug bei 2.85 kW PV!

### Root-Causes

| # | Problem | Ursache |
|---|---------|---------|
| 1 | **Thermostate heizen bei 18°C** | Die Hysterese der TGP508 ist ~0.5°C. Bei Raumtemp 18.6°C und Ziel 18°C läuft die Heizung weiter! |
| 2 | **Einige Räume nie pausiert** | Bad Uli, Büro, Wirtschaftsraum haben `heating_paused_reason: null` - sie wurden nie in die Budget-Logik einbezogen |
| 3 | **SKIP verhindert API-Calls** | `[PV-Automation] Zimmer Luca: SKIP - already at 18°C` - wenn target_temp bereits 18°C ist, wird kein neuer Befehl gesendet |

## Lösung: 3 Schritte

### Schritt 1: Niedrigere "Stopp-Temperatur" (15°C statt 18°C)

Um die Thermostat-Hysterese zu überwinden, muss die Pause-Temperatur **unter** der aktuellen Raumtemperatur liegen:

```typescript
// pv-automation/index.ts - Zeilen 1131-1136
if (!budgetStatus.allowedToHeat) {
  action = 'deactivate';
  targetTemp = 15;  // ÄNDERUNG: 15°C statt nightTemp (18°C)
  solarLimitTemp = null;
  reasoning = `⏸️ ${budgetStatus.reason} → 15°C (Stopp-Temp)`;
```

**Warum 15°C?**
- Aktuelle Raumtemperaturen: 18.3-19.4°C
- Mit 15°C als Ziel stoppt die Heizung GARANTIERT
- Fußbodenheizung kühlt langsam (~0.5°C/h), bei 30 Min Rotation bleibt der Raum über 17°C

### Schritt 2: Rooms ohne Pause-Reason pausieren

Bad Uli, Büro, Wirtschaftsraum haben `heating_paused_reason: null` - sie wurden nie vom Budget-System erfasst.

**Prüfen warum:**
- Möglicherweise `pv_auto_enabled: false` oder
- Sie wurden vor Aktivierung des Budget-Systems auf 22°C gesetzt

**Fix:** Beim nächsten Durchlauf ALLE Räume durch Budget-Logik prüfen, nicht nur die mit `heating_paused_reason`.

### Schritt 3: SKIP-Logik für Temperatur-Reduktion anpassen

Aktuell wird geskippt wenn `target_temp` bereits korrekt ist:

```typescript
// Aktuell (Problem):
const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp;

// needsToReduceTemp prüft:
const needsToReduceTemp = action === 'deactivate' && newTargetTemp < currentTargetTemp - 0.5;
```

**Problem:** Wenn `target_temp: 18` und wir auf 15°C reduzieren wollen, ist `18 < 18 - 0.5` = FALSE!

**Fix:** Die Reduktions-Erkennung korrigieren:

```typescript
// NEU: Prüfe ob neue Temp niedriger ist als aktuelle
const needsToReduceTemp = newTargetTemp < currentTargetTemp - 0.5;
```

## Dateiänderungen

### 1. `supabase/functions/pv-automation/index.ts`

**Zeilen 1131-1143 (Budget-Pause):**
```typescript
} else if (!budgetStatus.allowedToHeat) {
  // Budget reicht nicht - auf 15°C setzen damit Thermostat GARANTIERT stoppt
  action = 'deactivate';
  targetTemp = 15;  // 15°C - deutlich unter Raumtemperatur
  solarLimitTemp = null;
  reasoning = `⏸️ ${budgetStatus.reason} → 15°C (Stopp)`;
  console.log(`[PV-Automation] ${room.name}: BUDGET-PAUSE - ${reasoning}`);
```

**Zeilen 1114-1121 (Rotation):**
```typescript
if (budgetStatus.shouldRotate) {
  // Rotation: Raum hat zu lange geheizt, pausieren für andere
  action = 'deactivate';
  targetTemp = 15;  // 15°C statt nightTemp
  solarLimitTemp = null;
  reasoning = `🔄 ${budgetStatus.reason} → 15°C (Rotation)`;
```

**Zeilen 1182-1185 (SKIP-Logik korrigieren):**
```typescript
// WICHTIG: Bei jeder Temperatur-Reduktion API aufrufen
const needsToReduceTemp = newTargetTemp < currentTargetTemp - 0.5;
const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp;
```

## Erwartetes Ergebnis nach Fix

### Berechneter Ablauf:
```text
PV: 2.85 kW
Budget: ~2.55 kW (PV - Grundlast + Toleranz)

1. Wohnzimmer (2400W) → 22°C (nutzt Budget)
   Verbleibendes Budget: ~150W

2. Alle anderen → 15°C (Stopp-Temperatur)
   - Zimmer Luca: 18.8°C → Thermostat auf 15°C → STOPPT
   - Zimmer Luis: 18.8°C → Thermostat auf 15°C → STOPPT
   - Bad Uli: 19.8°C → Thermostat auf 15°C → STOPPT
   - etc.

Ergebnis:
- Aktiv: Wohnzimmer (2400W)
- Grundlast: ~500W
- Gesamt: ~2.9 kW
- PV: 2.85 kW
- Netzbezug: ~50W (statt 2.3 kW!)
```

### Rotation nach 30 Minuten:
```text
Wohnzimmer erreicht 22°C → 15°C (Pause)
Nächster Raum (z.B. Büro 900W) → 22°C (aktiv)
```

## Test-Plan

1. Edge Function deployen
2. pv-automation manuell triggern
3. Logs prüfen:
   - Alle Budget-Pausen sollten `→ 15°C` zeigen
   - Kein `SKIP` für Räume die pausiert werden sollen
4. Nach 5 Minuten Datenbank prüfen:
   - `is_heating: false` für alle Räume mit `target_temp: 15`
5. Dashboard prüfen:
   - Netzbezug sollte auf ~0W fallen

