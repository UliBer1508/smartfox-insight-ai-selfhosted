## Problem

Trotz **7,49 kW PV-Überschuss** und korrekter Budget-Planung (`Eco-Budget 9978W, 4/4 Räume parallel`) heizt **kein einziger Raum**.

Ursache laut Edge-Function-Logs: bei jedem 2-min Heartbeat crasht die Function mit:

```
ReferenceError: currentlyHeatingPower is not defined
  at pv-automation/index.ts:1715:129
```

Die Variable `currentlyHeatingPower` wird in Zeile **1372** als `const` innerhalb des `if (powerBudgetEnabled && pvPower > 500) { ... }`-Blocks deklariert — wird aber später in Zeile **1865** (Phase-1-Eco-Header-Log) und im `[PARALLEL-PLAN]`-Log außerhalb dieses Blocks referenziert. JavaScript Block-Scoping → ReferenceError → Function bricht ab, bevor irgendein `set_temperature`-Befehl erzeugt wird.

Zusatz-Problem (Folge davon): Quota ist bereits ausgeschöpft (`0/30 heute, 3807/3000 monatlich`) und `lastLocalExec=none` → selbst PV-Priority-Notfall-Calls werden nicht abgesetzt. Das ist aber sekundär — der Crash verhindert sogar das Schreiben in `thermostat_commands` für den lokalen Pfad.

## Fix

**1. Variable in den äußeren Scope hochziehen** (`supabase/functions/pv-automation/index.ts`)

`currentlyHeatingPower` muss vor dem `if (powerBudgetEnabled)`-Block als `let` deklariert werden, damit sie in allen Verwendungen (`baseBudget`, PARALLEL-PLAN-Log, Phase-1-Header-Log) verfügbar ist:

```ts
// Vor dem Budget-Block deklarieren:
const currentlyHeatingPower = rooms
  .filter(r => r.is_heating)
  .reduce((sum, r) => sum + (r.calculated_power_w || r.heating_power_w || 800), 0);

let budgetMode: ... = 'unlimited';
let availableBudget = 999999;
let comfortBudget = 999999;

if (powerBudgetEnabled) {
  if (pvPower > 500) {
    budgetMode = 'pv_optimized';
    const dynamicTolerance = ...;
    let baseBudget = gridExport + currentlyHeatingPower + dynamicTolerance;
    // ... rest unverändert
```

Die innere Re-Deklaration in Zeile 1372 wird entfernt.

**2. Verifizieren nach Deploy**

Edge-Function-Logs prüfen — erwartet:
- Kein `ReferenceError` mehr
- `[ACTIVATE]` Log-Zeilen für die 4 geplanten Eco-Räume (Bad Uli, Zimmer Uli, Luis, Luca, Kinder Bad)
- Entweder direkte Tuya-Calls (PV-Priority-Modus erlaubt 5 Notfall-Calls trotz Quota) oder Einträge in `thermostat_commands` für den lokalen Pfad

## Warum der Bug heute zuschlug

In der vorherigen Iteration (parallele Heating-Allocation v2.5) wurden die `[PARALLEL-PLAN]`- und `=== PHASE 1: ECO-RUNDE ===`-Log-Zeilen hinzugefügt, die `currentlyHeatingPower` referenzieren — aber die Variable blieb im inneren Block. Der Fehler trat erst auf, als das Logging ergänzt wurde (Phase-1-Header).

## Nicht im Scope

- Tuya-Quota: Das eigentliche Heizen heute hängt am PV-Priority-Modus (5 Notfall-Calls). Falls auch das nicht reicht, ist das ein separater Folge-Task. Erst Crash fixen, dann Verhalten beobachten.
- UI-Anzeige (Raumübersicht): Sobald Aktivierungen wieder durchlaufen, schreibt die Function `last_auto_change` und Tuya pusht die Targets — die schon implementierte „Eco gesetzt"-Badge sollte automatisch erscheinen.
