
# Option C: Mischform — Implementieren + Aufräumen

Ziel: Jeder einstellbare Parameter im UI hat eine echte Wirkung. Reine "Show-Felder" werden entfernt.

---

## A) Parameter, die echte Logik bekommen (implementieren)

### 1. `consumer_priority` → echte Reihenfolge in `pv-automation`
- **Aktuell:** UI-Dropdown (`battery,hotwater,heating,car`), aber Code hat Reihenfolge hartcodiert.
- **Fix:** In `supabase/functions/pv-automation/index.ts` die Bonus-/Budget-Allokation an die in `consumer_priority` definierte Reihenfolge koppeln:
  - `battery` vor `heating` → Batterieladung-Reserve abziehen (heutiges Verhalten).
  - `heating` vor `battery` → Reserve entfällt, Eco-Budget = voller `gridExport + tolerance`.
  - `hotwater` vor `heating` → Heizungs-Eco erst freigeben, wenn Warmwasser-Slot (`hotwater_schedule_*`) abgedeckt ist.
  - `car` vor `heating` → `car_min_charge_power_w` vom `availableBudget` abziehen, solange `car_charging_enabled = true`.
- **Erweiterung:** `car_min_charge_power_w` wird damit ebenfalls echt verwendet (heute nur Default).

### 2. `electricity_base_fee_year_eur` → echte Kostenrechnung
- **Aktuell:** Nur in `useHeatingSettings.ts` Default, nirgends gelesen.
- **Fix:** In `EnergyCostWidget.tsx` und `useEnergyCosts.ts` die jährliche Grundgebühr anteilig (`base_fee / 365`) zu `grid_cost_eur` pro Tag addieren. Tooltip/Legende ergänzen ("inkl. Grundgebühr X€/Jahr").

### 3. `pv_surplus_threshold_on/off` → echte Hysterese in Heiz-Aktivierung
- **Aktuell:** Nur in PV-Automation-Settings-Initialisierung gelesen (Zeilen 335/336/908/909) — aber **nicht** als Aktivierungs-/Deaktivierungs-Schwelle für Räume verwendet (dort wird `availableBudget` direkt verglichen).
- **Fix:** In `pv-automation` Eco-Aktivierungs-Pfad eine echte Hysterese einbauen:
  - Raum darf nur aktiviert werden, wenn `gridExport >= pv_surplus_threshold_on`.
  - Raum wird deaktiviert, wenn `gridExport < pv_surplus_threshold_off` (in Verbindung mit bestehender toleranter Deaktivierung).
- Damit haben die UI-Felder echte Wirkung, statt nur als Default für ein nicht genutztes Feature zu dienen.

### 4. `floor_heating_response_hours` → echtes Pre-Heat
- **Aktuell:** UI-Feld, kein Code-Konsument.
- **Fix:** In Eco-Aktivierungs-Logik: Wenn aktuelle Wien-Zeit `< (night_end_time + 0)` und `<= (night_end_time + floor_heating_response_hours)`, darf Eco bereits eine Stunde vor `night_end_time` mit Vorlauf starten — nur wenn `gridExport > pv_surplus_threshold_on`. So wird die Trägheit der Fußbodenheizung realistisch berücksichtigt.

---

## B) Parameter, die aus dem UI entfernt werden (DB-Spalten bleiben)

In `src/components/heating/HeatingSettingsForm.tsx` und `src/components/heating/RoomManager.tsx` entfernen:

1. **`preheat_hours`** — wird durch das neue `floor_heating_response_hours` (Pkt. A4) ersetzt; doppeltes Konzept.
2. **`pv_boost_max_temp`** (RoomManager Zeile 328) — kein Code-Konsument; Komfort-Cap wird bereits durch `comfort_temp + pv_boost_temp_delta` (globale Heizungs-Settings) erreicht.
3. **`solar_heating_temp`** (Room-Spalte) — bereits per Memo `solar-logic-simplified-removal` deprecated.
4. **`estrich_storage_enabled`** — nur in AI-Prompts; entweder ganz raus oder klar als "AI-Hint" labeln. Plan: entfernen.
5. **`night_cycling_enabled`** + **`avg_night_cycles_per_room`** — nur in Pattern-Analyse-Prompt. Plan: entfernen, AI-Prompt nutzt stattdessen die echten `room_heating_logs`.

DB-Spalten **bleiben** (kein Migration-Risiko, kein Datenverlust). Nur UI-Felder werden entfernt.

---

## C) Memory-Updates

- Neuer Eintrag `mem://features/heating/parameter-usage-audit-c.md`: dokumentiert welcher Parameter wo wirkt.
- Update `mem://arch/pv-automation-budget-logic-v2`: Hysterese (`pv_surplus_threshold_on/off`) und `consumer_priority`-Reihenfolge ergänzen.
- Update `mem://features/heating/night-and-day-logic-constraints`: `floor_heating_response_hours` als legitimer Vorlauf vor `night_end_time`.
- Update `mem://index.md` Core: Hinweis "Alle UI-Settings haben aktive Logik — keine Dekorations-Felder".

---

## D) Betroffene Dateien

- `supabase/functions/pv-automation/index.ts` (consumer_priority, hysterese, floor_heating_response_hours, car_min_charge_power_w)
- `src/hooks/useEnergyCosts.ts` + `src/components/energy/EnergyCostWidget.tsx` (Grundgebühr)
- `src/components/heating/HeatingSettingsForm.tsx` (entfernen: preheat_hours, estrich_storage_enabled, night_cycling_enabled, avg_night_cycles_per_room)
- `src/components/heating/RoomManager.tsx` (entfernen: pv_boost_max_temp, solar_heating_temp Felder)
- `src/hooks/useHeatingSettings.ts` (Defaults der entfernten Felder bereinigen)
- 4 Memory-Dateien (siehe C)

---

## Nicht im Scope

- Keine DB-Migrationen (Spalten bleiben, falls später wieder gebraucht).
- Keine Änderung an Tuya-Quota-Logik (ist eigenes Thema, separat halten).
- Keine Änderung am 09:00-Hardcode (Punkt 1 aus vorherigem Plan ist separat).
