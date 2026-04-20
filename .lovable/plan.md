

## Befund

**Problem:** Trotz Batterie-Reserve-Setting `battery_reserve_for_night_soc = 80%` kann das System die Batterie für Heizung entladen, wenn SOC unter 80% liegt. Aktuell: SOC 60% (steigend), Verbrauch 2200W bei nur 1700W PV → Differenz wird teilweise aus Batterie gedeckt, falls Heizung läuft.

### Lücken in der aktuellen Logik (`pv-automation/index.ts`)

1. **Kein Hard-Gate auf SOC vs. Reserve:** Der Reserve-Wert wirkt nur über drei indirekte Mechanismen (Mikro-Budget-Untergrenze, Batterie-Buffer-Bonus, Soft-Decrease). Es fehlt ein striktes „SOC < Reserve → keine neue Heizaktivierung".

2. **`batteryEcoReserveAllowed` ignoriert Reserve:** Die Erlaubnis Batterie-Entladung für Eco-Heizung nach Sunset basiert hartkodiert auf `batterySoc > 50`, nicht auf `batterySoc > batteryReserveSoc`. Bei Reserve 80% und SOC 65% nach Sunset wird trotzdem die Batterie genutzt.

3. **Ladereserve-Korrektur greift nur bis SOC 80%:** `if (batteryPower > 0 && batterySoc < 80)` — der Schwellwert ist hartkodiert statt aus der Reserve-Konfiguration.

4. **Battery-Drain-Korrektur unzureichend:** Bei `batteryPower < 0` (Entladung) wird das Budget zwar reduziert, aber nicht auf 0 erzwungen. Wenn `gridExport + heizend + toleranz` > Drain, bleibt Restbudget → Heizung darf laufen, obwohl Batterie entlädt.

5. **`comfortBudget` ist „strikt", aber nur via Drain-Subtraktion:** Wenn echter `gridExport > 0` ist, aber gleichzeitig Batterie entlädt (typisch bei wechselhaftem PV), wird Komfort-Heizung erlaubt.

## Lösungskonzept

### Neue Einstellung: Hartes SOC-Gate

Eine neue Variable `heating_min_battery_soc` (Default = `battery_reserve_for_night_soc`, also 80%) wird zur einzigen Wahrheit für „darf Heizung Batterie nutzen?". Zwei Modi:

- **Strict (Standard):** SOC < Gate → **keine neue Aktivierung**, **bereits heizende Räume sofort beenden**, sobald Batterie entlädt.
- **Soft (optional):** SOC < Gate → nur neue Aktivierungen blockiert; laufende Räume dürfen bis Hysterese fertigheizen.

### Konkrete Änderungen in `pv-automation/index.ts`

1. **Hard-Gate vor Phase 1 + Phase 2:** Direkt nach Budget-Berechnung:
   ```
   if (batterySoc < heatingMinSoc && batteryPower < 0) {
     availableBudget = 0;
     comfortBudget = 0;
     log: [SOC-GATE] SOC X% < Reserve Y%, Batterie entlädt → Budgets auf 0
   }
   ```
   Das verhindert *jede* neue Aktivierung und stoppt im nächsten Heartbeat-Tick laufende Räume (über bestehende Deaktivierungslogik, da Budget = 0).

2. **`batteryEcoReserveAllowed` an Reserve binden:**
   ```
   const batteryEcoReserveAllowed = afterSunset && ecoRoomsRemaining > 0 
     && batterySoc > heatingMinSoc;   // statt > 50
   ```

3. **Ladereserve-Korrektur dynamisch:**
   ```
   if (batteryPower > 0 && batterySoc < heatingMinSoc) { ... }
   ```
   statt hartcodiertem `< 80`.

4. **Tolerante Deaktivierung deaktivieren bei SOC < Gate:** Das Stack-up von 300W-Toleranzen wird übersprungen, wenn SOC unter Reserve.

5. **Mikro-Budget-Untergrenze schon abgedeckt** durch `microMinSoc = max(...)`, aber zur Sicherheit zusätzlich `< heatingMinSoc` blockieren.

### Neue UI-Anzeige

In `BatteryReserveStatus.tsx` (existiert bereits) eine Zeile ergänzen:

> „Heizung-Sperre aktiv ab: 80% SOC (aktuell 60% → **gesperrt**)"

mit rotem/grünem Badge je nach Status.

### Settings-Erweiterung

In `HeatingSettingsForm.tsx`:
- Neuer Slider „Heizung-Schutz: Mindest-SOC für Batterienutzung" (40–95%, Default 80).
- Erklärtext: „Heizung darf die Batterie nur entladen, wenn der Ladestand über diesem Wert liegt. Schützt die Batterie für Abend-/Nachtverbrauch."
- Toggle „Strikt (Standard) / Sanft": entscheidet ob laufende Räume sofort gestoppt werden.

### DB-Migration

Spalte `heating_min_battery_soc INTEGER DEFAULT 80` zu `heating_settings`. Falls NULL → Fallback auf `battery_reserve_for_night_soc`.

### Logging

Neuer Log-Marker `[SOC-GATE]` mit aktuellem SOC, Gate-Wert, Battery-Power und Aktion (gesperrt/erlaubt).

## Erwartetes Verhalten danach

- **Aktuell (SOC 60%, Reserve 80%, Batterie lädt mit ~600W):** Gate inaktiv (Batterie lädt), Budget normal — Heizung darf laufen, solange echter Überschuss da ist.
- **Bei SOC 60%, Batterie entlädt 200W:** Budget = 0 → Heizung sofort gestoppt, bis SOC wieder ≥ 80% oder Batterie wieder lädt.
- **Bei SOC 85%, Batterie entlädt 500W:** Gate inaktiv (über Reserve) — bestehender Prognose-/Buffer-Bonus greift wie bisher.

### Was unverändert bleibt

- Tuya-Quota-Logik, Mikro-Budget-Soft-Rotation, Phase-Strategie, Nacht-/Tag-Trennung, ML-Decision-Persistenz, alle UI-Komponenten außer den zwei genannten.

