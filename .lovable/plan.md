

# PV-Boost und Comfort-Eskalation funktionieren nicht: 3 Bugs

## Befund aus der Datenbank

Alle Räume stehen auf `target_temp = eco_temp` obwohl 4.5 kW eingespeist werden:

| Raum | eco | comfort | boost_max | target | Problem |
|------|-----|---------|-----------|--------|---------|
| Wohnzimmer | 20 | 22 | **22** | 20 | boost_max = comfort → kein Boost |
| Büro | 20 | 21 | **21** | 20 | boost_max = comfort → kein Boost |
| Zimmer Uli | 20 | 21 | **21** | 20 | boost_max = comfort → kein Boost |
| Zimmer Luca | 18.5 | 20 | 21 | 20 | Boost möglich, aber blockiert |
| Zimmer Luis | 18.5 | 20 | 21 | 20 | Boost möglich, aber blockiert |
| Bad Uli | 20 | 21 | **null** | 21 | kein boost_max gesetzt |
| Haustür | 19 | 21 | null | 18 | pv_auto_enabled=false |

## 3 Bugs identifiziert

### Bug 1: Boost-Schwelle zu hoch (Zeile 682)
```
const boostAllowed = availableHeatingKwh > 10 && forecastAccuracy >= 0.7;
```
Bei 73.5 kWh Prognose kein Problem, aber an normalen Tagen (20-30 kWh) nach Abzug von Batterie (~7 kWh), Warmwasser (~11 kWh), Auto bleibt oft < 10 kWh übrig.

**Fix:** Schwelle von `> 10` auf `> 3` senken.

### Bug 2: Boost prüft `pv_auto_enabled` statt `automation_enabled` (Zeile 1322)
```
if (boostAllowed && room.pv_auto_enabled && !isNight) {
```
5 Räume haben `pv_auto_enabled: false` aber `automation_enabled: true` — sie nehmen nie am Boost teil.

**Fix:** `room.pv_auto_enabled` → `room.automation_enabled`

### Bug 3: Boost erfordert comfort_temp, aber Räume kommen nie auf comfort (Zeile 1327)
```
if (currentRoomTemp >= comfortTemp - 0.5 && currentRoomTemp < boostMaxTemp - 0.3) {
```
Der Boost wartet bis der Raum `comfort_temp - 0.5` erreicht hat. Aber die Budget-Logik (Zeile 1299) setzt zuerst auf `eco_temp`. Der Raum muss eco → comfort physisch durchheizen, bevor der Boost überhaupt geprüft wird. Bei `pv_boost_max_temp == comfort_temp` (Büro, Wohnzimmer, Zimmer Uli) gibt es dann keinen Spielraum mehr.

**Fix:** Boost ab `ecoTemp - 0.5` erlauben statt `comfortTemp - 0.5`. UND: Wenn `pv_boost_max_temp` fehlt oder <= comfort_temp, Fallback auf `comfort_temp + boostDelta`.

### Zusätzlich: Budget-Logik setzt nicht auf comfort
Die Budget-Logik (Zeile 1294-1305) soll bei genügend PV von eco auf comfort eskalieren. Aber die Bedingung `currentRoomTemp < ecoTemp - 0.5` ist bei Räumen die bereits auf eco sind (z.B. Wohnzimmer 21°C, eco 20°C) nicht erfüllt — also wird `comfortTemp` gesetzt. **Aber** der Raum steht trotzdem auf target=20 (eco). Das bedeutet die Budget-Logik greift gar nicht oder wird von anderem Code überschrieben.

## Änderungen

**`supabase/functions/pv-automation/index.ts`:**

1. **Zeile 682**: `availableHeatingKwh > 10` → `availableHeatingKwh > 3`
2. **Zeile 1322**: `room.pv_auto_enabled` → `room.automation_enabled`
3. **Zeile 1324**: Fallback sicherstellen:
   ```typescript
   const boostMaxTemp = (room as any).pv_boost_max_temp && (room as any).pv_boost_max_temp > comfortTemp
     ? (room as any).pv_boost_max_temp
     : comfortTemp + boostDelta;
   ```
4. **Zeile 1327**: `comfortTemp - 0.5` → `ecoTemp - 0.5` (Boost greift früher)
5. **Zeile 1328**: Surplus-Schwelle senken: `gridExport > 1000` → `gridExport > 500` (passt zum Setting `pv_surplus_threshold_on`)

Nach den Änderungen: Edge Function deployen und testen.

