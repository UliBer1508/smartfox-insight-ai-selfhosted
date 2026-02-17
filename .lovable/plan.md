

# Heizregelung: Alle Faktoren einbeziehen (PV, Grid, KI-Empfehlungen, ML-Policies)

## Aktuelle Probleme

### 1. Budget = 0W bei wenig PV (Zeile 679-683)
Wenn PV < 500W, wird `availableBudget = 0` gesetzt. Dadurch werden ALLE Raeume ueber die Budget-Override-Logik (Zeile 1226) auf `nightTemp` gesetzt - auch tagsueber. Raeume werden nicht geheizt.

### 2. Budget-Override greift auch im Grid-Modus (Zeile 1226)
Die Bedingung `if (powerBudgetEnabled && (!isNight || batterySoc < 30))` aktiviert Rotation und Budget-Stopp auch wenn kein PV da ist. Im Grid-Modus ist das unnoetig - alle Raeume koennen gleichzeitig heizen.

### 3. Morgen-Sperre blockiert Basis-Heizen (Zeile 1072-1085)
`isOptimalHeatingTime()` blockiert das Aufwaermen wenn die aktuelle Stunde nicht in `optimal_solar_hours` liegt UND PV < 2000W UND Batterie < 80%. Der Raum bleibt auf `nightTemp` - auch an trueben Tagen ohne PV.

### 4. PV-Budget springt sofort auf comfort_temp (Zeile 1260-1265)
Wenn Budget erlaubt zu heizen, wird sofort `comfortTemp` (21 Grad C) gesetzt. Besser: Zuerst auf `ecoTemp` heizen, dann bei genuegend PV auf `comfortTemp`.

### 5. Sued-Raum Morgensperre zu aggressiv (Zeile 1109-1117)
Sued-Raeume werden auf `solarTemp` (17 Grad C) gesetzt waehrend sie auf Solargewinn warten - das ist unter eco_temp.

## Loesung: Zwei-Modi-Logik mit KI-Integration

### Modus A: PV-optimiert (pvPower >= 500W)
- Sequenzielles Heizen nach Prioritaet (bestehendes Budget-System)
- **Zuerst eco_temp**, dann comfort_temp wenn genuegend PV
- ML-Policies und KI-Empfehlungen steuern Timing und Prioritaet
- Rotation und Budget-Stopp aktiv

### Modus B: Grid-Fallback (pvPower < 500W)
- Alle Raeume gleichzeitig auf eco_temp (Tag) / night_temp (Nacht)
- KEIN Budget-Override, KEINE Rotation
- Vorhandener PV-Strom reduziert Netzbezug automatisch
- KI-Empfehlungen und ML-Policies bleiben aktiv fuer Temperaturwahl

## Technische Aenderungen in `supabase/functions/pv-automation/index.ts`

### Aenderung 1: Grid-Budget statt 0W (Zeile 679-683)

```text
// Vorher:
budgetMode = 'grid_sequential';
availableBudget = 0;

// Nachher:
budgetMode = 'grid_sequential';
availableBudget = maxGridHeatingPower; // 2000W - genug fuer Grid-Heizen
```

### Aenderung 2: Budget-Override NUR im PV-Modus (Zeile 1226)

```text
// Vorher:
if (powerBudgetEnabled && (!isNight || (batterySoc !== null && batterySoc < 30))) {

// Nachher:
if (powerBudgetEnabled && budgetMode === 'pv_optimized') {
```

Im Grid-Modus (`grid_sequential`) greift keine Rotation und kein Budget-Stopp. Raeume heizen einfach auf ihre Zieltemperatur (eco_temp tagsueber, night_temp nachts).

### Aenderung 3: PV-Budget zuerst eco, dann comfort (Zeile 1260-1265)

```text
// Vorher:
targetTemp = comfortTemp;  // 21°C sofort

// Nachher:
const currentRoomTemp = room.current_temp || 0;
if (currentRoomTemp < ecoTemp - 0.5) {
  targetTemp = ecoTemp;
  reasoning = "PV-Heizen: zuerst eco_temp (Raum noch kalt)";
} else {
  targetTemp = comfortTemp;
  reasoning = "PV-Komfort: genuegend PV fuer comfort_temp";
}
```

### Aenderung 4: Morgen-Aufwaermen immer auf eco_temp erlauben (Zeile 1072-1085)

```text
// Vorher: ML sagt "nicht optimal" -> nightTemp beibehalten
action = 'keep';
targetTemp = nightTemp;

// Nachher: Trotzdem auf eco_temp aufwaermen (Grid-Fallback)
action = 'activate';
targetTemp = ecoTemp;
reasoning = "Morgen-Aufwaermen auf eco_temp (Grid, warte auf PV fuer Komfort)";
```

ML-optimale Stunden steuern nur das PV-KOMFORT-Heizen (comfort_temp). Basis-Heizen auf eco_temp passiert immer.

### Aenderung 5: Sued-Raum Morgensperre auf eco_temp (Zeile 1109-1117)

```text
// Vorher: solarTemp (17°C), action = 'deactivate'
action = 'deactivate';
targetTemp = solarTemp;

// Nachher: Mindestens eco_temp halten
action = 'activate';
targetTemp = ecoTemp;
reasoning = "Warte auf Solargewinn, halte eco_temp";
```

## Zusammenspiel aller Faktoren

```text
1. Nacht (22:00-06:00):
   -> night_temp (bei leerem Akku: night_temp - 2°C, min 15°C)
   -> KI/ML inaktiv

2. Tag + PV >= 500W (Modus A):
   -> Budget = PV - Grundlast
   -> Sequenziell heizen (Rotation alle 30 Min)
   -> ML-Policy bestimmt optimale Stunden fuer comfort_temp
   -> Zuerst eco_temp, dann comfort_temp bei genuegend PV
   -> KI-Empfehlungen fuer Temperaturwahl und Prioritaet

3. Tag + PV < 500W (Modus B):
   -> Budget = max_grid_heating_power (2000W)
   -> Alle Raeume gleichzeitig auf eco_temp
   -> KEIN Budget-Override/Rotation
   -> KI/ML aktiv fuer Temperaturwahl (kann eco_temp anpassen)
   -> Vorhandener PV-Strom wird automatisch mitgenutzt

4. Morgen-Aufwaermen:
   -> IMMER auf eco_temp (Grid wenn noetig)
   -> ML steuert nur WANN comfort_temp erreicht wird
   -> Sued-Raeume: eco_temp statt solarTemp waehrend Warten

5. Solargewinn erkannt:
   -> Heizung reduzieren (solarTemp)
   -> Raum darf sich durch Sonne bis comfort_temp erwaermen
```

## Betroffene Datei

| Datei | Aenderungen |
|---|---|
| `supabase/functions/pv-automation/index.ts` | 5 Stellen: Budget, Override-Bedingung, PV eco-first, Morgensperre, Sued-Sperre |

