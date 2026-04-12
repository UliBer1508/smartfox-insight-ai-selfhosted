

# Fix: Zimmer Luis & Luca bleiben auf Nacht statt Eco/Komfort geheizt zu werden

## Problem-Analyse

Aktueller Zustand laut Datenbank:
- **Zimmer Luis** (Prio 3): `target_temp = 18.5°C`, `current_temp = 19.8°C`, `eco_temp = 18.5`, `night_temp = 18.5`, `comfort_temp = 20`
- **Zimmer Luca** (Prio 4): `target_temp = 18.5°C`, `current_temp = 20.2°C`, `eco_temp = 18.5`, `night_temp = 18.5`, `comfort_temp = 20`

**Problem 1 — "Komfort erreicht" obwohl Thermostat auf Nacht steht:**
Die 2-Phasen-Logik prüft nur `current_temp` gegen `comfort_temp - 0.3`:
- Luis: 19.8 >= 19.7 → "Komfort erreicht" → `action = 'keep'` → target_temp bleibt 18.5°C
- Luca: 20.2 >= 19.7 → "Komfort erreicht" → `action = 'keep'` → target_temp bleibt 18.5°C

Das System hält die Räume für "warm genug" und ändert den Thermostat nicht. Aber der Thermostat steht auf 18.5°C — die Räume kühlen auf 18.5°C ab!

**Problem 2 — `eco_temp = night_temp = 18.5°C`:**
Wenn eco und night identisch sind, kann das System nicht unterscheiden ob ein Raum "auf Eco geheizt" oder "auf Nacht" steht. Die Phase-1-Logik überspringt den Raum ("already >= eco"), Phase 2 sagt "Komfort erreicht" — und niemand stellt den Thermostat um.

**Problem 3 — PV-Priority Calls werden für Deaktivierung verschwendet:**
Der einzige PV-Priority-Call ging an Wirtschaftsraum (18°C deaktivieren), statt an Räume die aufgeheizt werden müssen.

## Lösung

### 1. Thermostat-Zieltemperatur in die Budget-Logik einbeziehen
Die 2-Phasen-Logik muss nicht nur `current_temp` prüfen, sondern auch `target_temp`. Wenn ein Raum zwar warm genug ist, aber der Thermostat auf `night_temp` steht, muss der Thermostat trotzdem auf `eco_temp` bzw. `comfort_temp` gestellt werden.

**Datei: `supabase/functions/pv-automation/index.ts`**

In der Eco-Runde (Zeile ~1070) und Komfort-Runde (Zeile ~1109) zusätzlich prüfen: Steht der Thermostat (`target_temp`) noch auf `night_temp`? Dann muss er auf eco/comfort gesetzt werden, auch wenn die Raumtemperatur bereits stimmt.

```typescript
// Phase 1: Eco-Runde — NEUE Logik
if (currentTemp < ecoTemp - 0.3 || rp.room.target_temp <= rp.room.night_temp) {
  // Raum braucht eco (entweder zu kalt ODER Thermostat steht noch auf Nacht)
  ...
}

// Phase 2: Komfort-Runde — NEUE Logik  
if (currentTemp >= ecoTemp - 0.3 && (currentTemp < comfortTemp - 0.3 || rp.room.target_temp < comfortTemp)) {
  // Raum braucht comfort upgrade
  ...
}
```

### 2. "Keep" bei niedrigem Thermostat-Target korrigieren
In der PV-Heizlogik (Zeile ~1701-1735): Wenn `action = 'keep'` aber `target_temp < eco_temp`, dann `action = 'activate'` setzen:

```typescript
if (targetLevel === 'comfort') {
  if (currentRoomTemp < comfortTemp - 0.3 || currentTargetTemp < comfortTemp) {
    action = 'activate';
    targetTemp = comfortTemp;
    ...
  }
} else if (targetLevel === 'eco') {
  if (currentRoomTemp < ecoTemp - 0.3 || currentTargetTemp < ecoTemp) {
    action = 'activate';
    targetTemp = ecoTemp;
    ...
  }
}
```

### 3. PV-Priority: Aufheiz-Calls priorisieren vor Deaktivierungen
Deaktivierungen (Wirtschaftsraum → 18°C) sollen keine PV-Priority-Calls verbrauchen. PV-Priority ist für das **Aufheizen** reserviert.

**Änderung in der Tuya-Call-Funktion (~Zeile 520-528):**
PV-Priority-Counter nur bei `activate`-Aktionen hochzählen, nicht bei `deactivate`.

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` (3 Stellen anpassen)

### Auswirkung nach Deploy
- Nächster Zyklus erkennt: Zimmer Luis hat `target_temp = 18.5` < `comfort_temp = 20` → muss auf 20°C gesetzt werden
- Zimmer Luca ebenso
- PV-Priority-Calls werden für Aufheizung verwendet, nicht für Deaktivierung
- Reihenfolge bleibt: Bad Uli (1), Zimmer Uli (2), Zimmer Luis (3), Zimmer Luca (4), ...

