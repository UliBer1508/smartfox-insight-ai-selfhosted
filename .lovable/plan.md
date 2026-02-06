

# Plan: KI-Lernsystem mit echter Optimierung verbinden

## Problemanalyse

Das aktuelle System hat eine **kritische Lücke**:

### Was funktioniert:
1. **Daten werden gesammelt**: `learning_events` enthält tausende Entscheidungen
2. **Evaluation findet statt**: Rewards werden berechnet (durchschnittlich negativ: -0.27 bis -1.0)
3. **ML-Features werden extrahiert**: `optimal_solar_hours` werden für jeden Raum berechnet (z.B. `[11:00, 12:00, 13:00]`)
4. **KI bekommt die Daten im Prompt** gezeigt

### Was NICHT funktioniert:
1. **Morgen-Aufwärmung ignoriert Lernerkenntnisse**: Um 08:00 werden ALLE Räume auf `eco_temp` gesetzt - egal ob die KI gelernt hat, dass Heizen um 11:00 besser wäre
2. **`optimal_solar_hours` werden nur im Prompt erwähnt**, aber nirgends als harte Regel verwendet
3. **Morning-Wait nur für Süd-Räume mit `has_solar_gain`**: Nord-Räume heizen trotzdem morgens aus dem Netz
4. **Die KI "empfiehlt" nur**, aber das System führt hart-kodierte Logik aus

### Statistische Beweise:
```
activate-Entscheidungen: 0 positive Rewards, 100% negativ
Durchschnittlicher Reward: -0.27 bis -1.0 
=> Das System macht systematisch schlechte Heizentscheidungen!
```

---

## Lösung: Zeitbasiertes PV-Optimiertes Heizen

### Konzept: "Heizen nur in optimalen Stunden"

Statt morgens um 08:00 alle Räume zu heizen, soll das System:
1. Die `optimal_solar_hours` aus den ML-Features laden
2. Nur während dieser Stunden aktiv heizen
3. Außerhalb dieser Stunden: Nur Frostschutz oder minimale Temperatur halten

### Neue Logik in pv-automation

```text
FÜR JEDEN RAUM:
  1. Lade optimal_solar_hours aus room_ml_features
     (z.B. ['11:00', '12:00', '13:00'])
  
  2. WENN aktuelle Stunde IN optimal_solar_hours:
     → Aktives Heizen erlaubt (mit Leistungsbudget-Check)
     → Zieltemperatur: eco_temp oder comfort_temp
  
  3. WENN aktuelle Stunde NICHT in optimal_solar_hours:
     → NUR Frostschutz (night_temp)
     → ODER wenn Batterie >80%: eco_temp erlaubt
     → KEIN aktives Heizen aus dem Netz!
  
  4. Ausnahme: Raum unter Frostschutz-Grenze (z.B. <14°C)
     → Immer minimal heizen
```

### Erweiterung der ML-Features-Nutzung

```text
room_ml_features enthält bereits:
- optimal_solar_hours: ['11:00', '12:00', '13:00']
- pv_heating_ratio: 0.65 (65% PV-Anteil beim Heizen)
- grid_import_ratio: 0.35 (35% Netzbezug)
- avg_heating_duration_min: 45

NEUE NUTZUNG:
- optimal_solar_hours → Steuerung WANN geheizt werden darf
- pv_heating_ratio → Schwellwert für "gute" Entscheidung (Ziel: >80%)
- avg_heating_duration_min → Berechnung wie lange vor optimal_solar_hours gestartet werden muss
```

---

## Technische Umsetzung

### 1. Änderungen in pv-automation/index.ts

**Neue Funktion: `isOptimalHeatingTime`**
```typescript
function isOptimalHeatingTime(
  roomId: string,
  mlFeatures: Record<string, any>[],
  wienHour: number,
  batterySoc: number,
  minBatterySoc: number
): { canHeat: boolean; reason: string } {
  const roomFeatures = mlFeatures.find(f => f.room_id === roomId);
  
  if (!roomFeatures?.optimal_solar_hours?.length) {
    // Keine ML-Daten → Fallback auf altes Verhalten
    return { canHeat: true, reason: 'Lernphase aktiv' };
  }
  
  const currentHourStr = `${String(wienHour).padStart(2, '0')}:00`;
  const isOptimal = roomFeatures.optimal_solar_hours.includes(currentHourStr);
  
  if (isOptimal) {
    return { canHeat: true, reason: `Optimale Heizstunde (ML: ${roomFeatures.optimal_solar_hours.join(', ')})` };
  }
  
  // Außerhalb optimaler Stunden: Nur bei hohem Batterie-SOC
  if (batterySoc > 80) {
    return { canHeat: true, reason: `Batterie >80%, außerhalb optimaler Stunden erlaubt` };
  }
  
  return { 
    canHeat: false, 
    reason: `Warte auf optimale Stunden: ${roomFeatures.optimal_solar_hours.join(', ')} (aktuell ${wienHour}:00)`
  };
}
```

**Änderung der Morning-Wakeup-Logik**
```typescript
// VORHER: needsMorningWakeup → alle Räume aufheizen
// NACHHER: Prüfe zuerst optimal_solar_hours

if (needsMorningWakeup) {
  const { canHeat, reason } = isOptimalHeatingTime(room.id, mlFeatures, wienHour, batterySoc, minBatterySoc);
  
  if (canHeat) {
    action = 'activate';
    targetTemp = ecoTemp;
    reasoning = `Morgen-Aufwärmen: ${reason}`;
  } else {
    // NICHT heizen - warte auf optimale Stunden!
    action = 'keep';
    targetTemp = nightTemp; // Niedrige Temperatur halten
    reasoning = `Morgen-Sperre: ${reason}`;
  }
}
```

### 2. ML-Features in pv-automation laden

Aktuell werden `room_ml_features` in `analyze-patterns` geladen, aber **nicht in pv-automation**!

**Neue Query hinzufügen:**
```typescript
// Lade ML-Features für alle Räume
const { data: mlFeatures } = await supabase
  .from('room_ml_features')
  .select('room_id, optimal_solar_hours, pv_heating_ratio, grid_import_ratio')
  .eq('date', getLocalDateString())
  .order('sample_count', { ascending: false });
```

### 3. Intelligente Vorheiz-Logik

```text
WENN optimal_solar_hours = ['11:00', '12:00', '13:00']
UND avg_heating_duration_min = 60 Minuten
UND Raum braucht 1°C Erwärmung

DANN: Starte Vorheizen um 10:00 (1 Stunde vorher)
      → Aber NUR wenn PV bereits >500W liefert
      → NICHT aus dem Netz!
```

---

## Änderungen an Dateien

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | ML-Features Query, `isOptimalHeatingTime()` Funktion, Morning-Wakeup Logik anpassen |
| `supabase/functions/analyze-patterns/index.ts` | Prompt erweitern: Erkläre dass optimal_solar_hours BINDEND sind |

---

## Erwartete Verbesserungen

| Metrik | Vorher | Nachher |
|--------|--------|---------|
| activate-Rewards | -0.27 bis -1.0 | Ziel: >0 |
| Netzbezug morgens | 5+ kW | Nahe 0 kW |
| PV-Eigennutzung | Niedrig | Maximiert durch zeitliche Verschiebung |

### Beispiel-Szenario

```text
06:00 - Nacht endet, Batterie 10%, PV 0W
       VORHER: Alle Räume auf eco_temp → 5kW Netzbezug!
       NACHHER: Räume bleiben auf night_temp, warten auf PV

10:00 - PV steigt auf 3kW, optimal_solar_hours beginnen
       NACHHER: Zimmer Luis startet (900W), Büro wartet (Budget)

11:00 - PV auf 8kW
       NACHHER: Mehrere Räume heizen gleichzeitig, alles aus PV

14:00 - PV sinkt, optimal_solar_hours enden für einige Räume
       NACHHER: Räume werden pausiert, halten Temperatur passiv
```

---

## Zusammenfassung

Das Kernproblem ist: **Das System sammelt Lerndaten, aber verwendet sie nicht für Entscheidungen.**

Die Lösung:
1. `optimal_solar_hours` aus ML-Features laden
2. Diese als BINDENDE Regel für Heizentscheidungen verwenden
3. Morning-Wakeup NUR erlauben wenn aktuelle Stunde in optimal_solar_hours
4. Außerhalb: Frostschutz-Modus, kein aktives Heizen aus dem Netz

