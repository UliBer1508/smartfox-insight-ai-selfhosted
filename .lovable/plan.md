## Adaptive Multi-Room Aktivierung nach Export-Budget

### Änderungen
**`supabase/functions/pv-automation/index.ts`** — Action-Loop refaktorieren:

1. **Budget berechnen:** `availableBudget = currentExport + (bereits heizende Räume × ihre geschätzte Leistung)` — minus `parallel_heating_safety_margin_w` (Default 200W).

2. **Räume nach Priorität (1→12) sortieren** und sequenziell prüfen:
   - **Skip** wenn `current_temp ≥ eco_temp − 0.3°C` (kein Call).
   - **Skip** wenn bereits aktiv mit korrektem Target (kein Call).
   - **Activate** wenn `roomPower ≤ remainingBudget` → 1 Tuya-Call, Budget reduzieren.
   - **Queue** sonst → kein Call, nur Log.

3. **Kein Status-Polling:** Raum-Zustand kommt aus DB. Edge Function ruft Tuya nur für tatsächliche Setpoint-Änderungen.

4. **Deaktivierungen** (Hysterese, Override, Komfort erreicht) bleiben uncapped.

5. **Logs:** `[BUDGET]`, `[ACTIVATE]`, `[QUEUE]`, `[SKIP]`.

6. **Nachschub** läuft automatisch über 2-min Heartbeat — kein Sondertimer nötig.

**`mem://features/heating/parallel-heating-allocation.md`** — auf Budget-basierte Allokation aktualisieren.

### Bleibt unverändert
Night-Silence-Gate (20:00–08:00), Hysterese, Override-Policy, SOC-Gates, Quota-Logic.
