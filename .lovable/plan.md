

# Heizlogik: Fehleranalyse

## Gefundene Fehler

### 1. KRITISCH: Nacht-Endzeit Inkonsistenz — pv-automation vs. heating_settings
Die `heating_settings` haben `night_end_time = 09:00`, aber im Code wird an einer Stelle ein Fallback `'06:00'` verwendet (Zeile 384: `nightEndTime || '06:00'`), und im `isMorningWaitPeriod` ist der Fallback `'08:00'` (Zeile 62). Das ist zwar aktuell irrelevant weil die Settings geladen werden, aber inkonsistent und fehleranfällig.

**Impact**: Gering (aktuell korrekt da Settings vorhanden), aber bei fehlenden Settings würden verschiedene Fallbacks greifen.

### 2. KRITISCH: Grid-Fallback setzt ALLE Räume auf eco_temp — IGNORIERT Budget-Logik
Im `grid_sequential` Modus (Zeile 671-676) wird `availableBudget = maxGridHeatingPower` (2000W) gesetzt. Aber der Budget-Override (Zeile 1155) greift NUR bei `budgetMode === 'pv_optimized'`:
```
if (powerBudgetEnabled && budgetMode === 'pv_optimized') {
```
Das bedeutet: Im `grid_sequential` Modus werden ALLE Räume gleichzeitig auf eco_temp gesetzt — ohne Leistungsbegrenzung. Bei 12 Räumen à ~800W = **~9.600W aus dem Netz**. Genau das hat heute Morgen die 6kW verursacht.

**Fix**: Budget-Override auch für `grid_sequential` aktivieren, oder alternativ die Fallback-Logik (Zeile 1113) auf maxGridHeatingPower begrenzen.

### 3. KRITISCH: `heating_paused_reason` wird nie zurückgesetzt bei Nachtmodus
Die Nachtmodus-Logik (Zeile 438-479) setzt `heating_paused_reason: null`, aber Räume die tagsüber auf `budget` gesetzt wurden, behalten diesen Status über Nacht. Beim nächsten Tag-Zyklus wird der Budget-Status aus `roomBudgetStatus` neu berechnet, aber `heating_paused_reason` in der DB bleibt stehen. Das verwirrt die Dashboard-Anzeige.

### 4. MITTELSCHWER: Morgen-Aufheizphase nach night_end_time fehlt
Die `isMorningWaitPeriod` prüft nur Räume mit `has_solar_gain`. Räume OHNE `has_solar_gain` (z.B. Haustür, Waschraum, Toilette) werden nach 09:00 nicht aktiv auf eco_temp hochgesetzt. Sie bleiben auf night_temp, bis entweder die Fallback-Logik greift (Zeile 1113: `currentTargetTemp < ecoTemp`) oder ML entscheidet. Das Fallback funktioniert grundsätzlich, aber es gibt eine Race-Condition mit dem `action === 'keep'` Check (Zeile 1068).

**Aktuell**: Zeile 1113 fängt das ab — ABER nur wenn `action` noch `'keep'` ist. Wenn vorher Solar-Erkennung oder ML aktiv wurde, wird es übersprungen.

### 5. MITTELSCHWER: `needsCorrection` Nacht-Check zu locker
Zeile 994: `currentTargetTemp !== nightTemp || room.pv_auto_active`
Verwendet `!==` statt einer Toleranz. Bei Gleitkomma-Vergleichen (z.B. 18.0 vs 18) könnte das zu unnötigen API-Calls führen. Gleichzeitig filtert Zeile 422 korrekt mit `Math.abs(...) >= 0.5`. Die beiden Checks sind inkonsistent.

### 6. GERING: today-Datum UTC vs. Wien-Zeit
Zeile 567: `const today = new Date().toISOString().split('T')[0]` — verwendet UTC-Datum für PV-Forecast-Abfrage. Zwischen 00:00 und 01:00 UTC (= 01:00-02:00 Wien) ist das noch das gestrige Datum. Für die Nachtzeit-Logik kein Problem (nachts werden keine PV-Forecasts gebraucht), aber inkonsistent mit der Wien-Zeit-Berechnung an anderen Stellen.

### 7. GERING: Doppelte Nachtmodus-Logik
Die Nachtmodus-Prüfung passiert zweimal:
1. Zuerst ab Zeile 387 (early return mit Tuya-Calls)
2. Dann nochmal ab Zeile 990 im Raum-Loop

Die erste Prüfung korrigiert Räume und gibt sofort `return` zurück. Die zweite wird nie erreicht wenn es Nacht ist. Das ist korrekt, aber redundant und verwirrend.

## Empfohlene Fixes (nach Priorität)

### Fix 1: Grid-Fallback Budget begrenzen (KRITISCH)
Budget-Override auch für `grid_sequential` aktivieren. Änderung in Zeile 1155:
```
if (powerBudgetEnabled && (budgetMode === 'pv_optimized' || budgetMode === 'grid_sequential'))
```
Damit wird das 2000W-Budget im Grid-Modus tatsächlich durchgesetzt und verhindert, dass 12 Thermostate gleichzeitig aus dem Netz heizen.

### Fix 2: Morgen-Aufheizung explizit triggern
Nach dem Night-Check (Zeile 1005) eine explizite Morgen-Aufheizlogik für ALLE Räume einfügen (nicht nur `has_solar_gain`), die `target_temp < eco_temp` haben. So werden Räume nach 09:00 zuverlässig hochgefahren.

### Fix 3: `today` Wien-Zeit für PV-Forecast
Zeile 567 auf Wien-Datum umstellen (wie bereits in der Persistierungs-Logik ab Zeile 845).

### Fix 4: `heating_paused_reason` im Nachtmodus bereinigen
In der Nachtmodus-Logik (Zeile 455) explizit `heating_paused_reason: null` setzen (wird bereits gemacht — OK).

