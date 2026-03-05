

# Fix: energy_per_degree und Effizienz-Metriken sind null

## Ursachen (3 Probleme gefunden)

### 1. Kaum `heating_start` Events vorhanden
In den letzten 7 Tagen: **6 starts** vs **55 stops**. Die meisten Starts wurden nicht geloggt (wegen der 401-Auth-Fehler der Cron-Jobs). Die Funktionen `calculateEnergyPerDegree` und `calculateEfficiencyMetrics` matchen Start→Stop-Paare -- mit nur 6 Starts gibt es fast keine Matches.

### 2. JavaScript Falsy-Bug bei `energy_estimate_wh = 0`
Zeile 278: `if (stop && stop.energy_estimate_wh && ...)` -- wenn `energy_estimate_wh` den Wert `0` hat (was bei vielen Stops der Fall ist), wird das als `false` gewertet. Aber auch Stops mit echten Werten > 0 werden nicht gefunden, weil der passende Start fehlt.

### 3. `avgCycles` zaehlt nur Starts pro Tag
Da Starts fehlen, ist `avgCycles` fuer die meisten Raeume `null`.

## Loesung

Die Berechnung von der Start→Stop-Paar-Logik entkoppeln und stattdessen **Stop-Events mit `duration_minutes`** als Basis verwenden (diese sind vollstaendig vorhanden).

### Aenderungen in `ml-feature-extraction/index.ts`

**1. `calculateEnergyPerDegree` umbauen:**
- Statt Start→Stop-Matching: Stop-Events mit `energy_estimate_wh > 0` UND `duration_minutes > 0` verwenden
- Start-Temperatur berechnen als: `stop.current_temp - (tempGain basierend auf heating_rate * duration)` 
- Oder einfacher: Raumleistung aus `rooms.calculated_power_w` nutzen und `energy / tempGain` aus den Stops berechnen, die sowohl `current_temp` als auch korrespondierende Temperature-Samples haben
- Pragmatischster Ansatz: Fuer jeden Stop mit `energy > 0` die Temperature-Sample am naechsten zum Startzeitpunkt (= stop.timestamp - duration_minutes) suchen

**2. `calculateEfficiencyMetrics` / `getHeatingPeriods` umbauen:**
- Statt Start→Stop-Matching: Heating-Perioden aus Stop-Events rekonstruieren
- `period.start = stop.timestamp - duration_minutes`, `period.end = stop.timestamp`
- Damit koennen energy_readings waehrend jeder Heizperiode zugeordnet werden

**3. `calculateHeatingBehavior.avgCycles` fixen:**
- Stops pro Tag zaehlen statt (fehlende) Starts

**4. Falsy-Bug fixen:**
- `stop.energy_estimate_wh` → `stop.energy_estimate_wh != null && stop.energy_estimate_wh > 0`
- `start.current_temp` → `!= null` Pruefungen

### Betroffene Datei
- `supabase/functions/ml-feature-extraction/index.ts` -- 3 Funktionen anpassen

### Erwartetes Ergebnis
- `energy_per_degree_wh`: Sollte fuer ~8 Raeume berechenbar sein (die Stops mit energy > 0 haben)
- `pvRatio/gridRatio/batteryRatio`: Sollte fuer alle Raeume mit Stop-Events berechenbar sein
- `avgCycles`: Sollte fuer alle Raeume mit regelmaessigen Heizzyklen berechenbar sein
- **Konfidenz steigt von ~45% auf ~70-85%**

