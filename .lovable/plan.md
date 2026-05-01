## Ziel

Phase 1 (Eco) und Phase 2 (Komfort) **strikt sequentiell** statt parallel.

**Begründung:** Wenn der gesamte Überschuss zuerst in Eco-Aufheizung fließt, sind alle Räume schneller auf Eco. Komfort startet danach gemeinsam — kein „ein Raum wird schon auf Komfort hochgezogen, während andere noch frieren".

## Aktuelles Verhalten (Problem)

`supabase/functions/pv-automation/index.ts` Zeilen 2161–2226:

> „Phase 2 läuft IMMER. Räume die bereits >= Eco sind dürfen sofort auf Komfort upgraden, unabhängig davon ob andere Räume noch in Phase 1 hochheizen."

Folge: Bei 9 kW Überschuss kann Wohnzimmer (Prio 1, schon Eco) sofort auf Komfort hochgehen und 2400 W ziehen — und der Bad-Raum (Prio 5, noch unter Eco) wartet auf Budget, das gerade von Wohnzimmer-Komfort verbraucht wird.

## Neues Verhalten

```text
Phase 1 (Eco):
  ├─ alle Räume mit current_temp < eco_temp − 0.3
  ├─ sortiert 1→12 nach Priorität
  └─ aktivieren bis availableBudget erschöpft

Gate: phase1Complete = TRUE wenn KEIN Raum mehr eco-bedürftig ist
                       (alle current_temp >= eco_temp − 0.3 ODER blockiert
                        durch Override/Pause)

Phase 2 (Komfort) — startet NUR wenn phase1Complete:
  ├─ alle Räume mit eco_temp ≤ current_temp < comfort_temp − 0.3
  ├─ sortiert 1→12 nach Priorität
  └─ aktivieren bis comfortBudget erschöpft
```

Wenn auch nur ein Raum noch unter Eco ist und heizen darf → Phase 2 wird **komplett übersprungen** in diesem Heartbeat. Beim nächsten 2-min-Tick wird neu geprüft.

## Code-Änderung

**Datei:** `supabase/functions/pv-automation/index.ts`

**1. Phase-1-Vollständigkeits-Check** nach der Phase-1-Schleife (~Zeile 2006) einfügen:

```ts
const phase1Complete = roomsWithPriority.every(rp => {
  const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
  const cur = rp.room.current_temp || 0;
  // Raum gilt als "Eco erreicht" wenn:
  //   - bereits warm genug, ODER
  //   - aktiv heizend (kommt gleich an), ODER
  //   - durch Pause/Rotation/Override blockiert (kann jetzt nichts beitragen)
  if (cur >= ecoTemp - 0.3) return true;
  const status = roomBudgetStatus.get(rp.room.id);
  if (status && !status.allowedToHeat) return true; // blockiert
  if (status?.targetLevel === 'eco' && status.allowedToHeat) return true; // aktiviert in Phase 1
  return false; // Raum will Eco, hat aber kein Budget → Phase 2 blockieren
});

console.log(`[PHASE-GATE] Phase 1 vollständig: ${phase1Complete}`);
```

**2. Phase-2-Block (Zeile 2172) in Bedingung wickeln:**

```ts
if (phase1Complete) {
  // bestehender Phase-2-Code
} else {
  console.log(`[PV-Automation] === PHASE 2: ÜBERSPRUNGEN === Eco-Phase noch nicht abgeschlossen — Komfort wartet bis alle Räume auf Eco`);
  // Räume die schon auf Komfort waren bleiben unverändert (kein Downgrade)
  for (const rp of roomsWithPriority) {
    if (!roomBudgetStatus.has(rp.room.id)) {
      const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
      const cur = rp.room.current_temp || 0;
      const targetLevel = cur >= comfortTemp - 0.3 ? 'comfort' : 'eco';
      roomBudgetStatus.set(rp.room.id, {
        allowedToHeat: true,
        reason: `Phase 2 wartet (Eco nicht komplett)`,
        shouldRotate: false,
        targetLevel,
      });
    }
  }
}
```

**3. Header-Hinweis & UI-Plan-Berechnung anpassen** (~Zeile 1896–1916):

`max_parallel_comfort` nur dann > 0 anzeigen, wenn alle Eco-Kandidaten ins Eco-Budget passen. Sonst ist es irreführend („+3 Komfort möglich" obwohl Phase 2 gerade blockiert ist).

```ts
// Komfort-Plan nur wenn Eco-Plan vollständig
const ecoFitsAll = ecoCandidates.length === ecoFit;
let comfortFit = 0, comfortSum = 0;
const plannedComfort: string[] = [];
if (ecoFitsAll) {
  for (const c of comfortCandidates) {
    if (comfortSum + c.power_w <= comfortBudget) {
      comfortSum += c.power_w; comfortFit++; plannedComfort.push(c.room_id);
    }
  }
}
```

## Memory Update

`mem://arch/pv-automation-strategy-v2` neu schreiben:

> **Strikt sequentielle 2-Phasen-Strategie:** Phase 2 (Komfort) startet erst wenn Phase 1 (Eco) vollständig abgeschlossen ist — d.h. jeder Raum ist entweder ≥ eco_temp − 0.3, aktiv am Aufheizen, oder durch Pause/Override blockiert. Bei nur einem Raum, der Eco anstrebt aber kein Budget hat, wird Phase 2 in diesem Heartbeat komplett übersprungen. Räume die bereits Komfort hatten, behalten Komfort (kein Downgrade durch Phase-2-Skip).

Auch Core-Eintrag im `mem://index.md` anpassen (von „PARALLEL" auf „sequentiell").

## Erwartetes Ergebnis

- Bei 9 kW Überschuss und 4 Räumen unter Eco: alle 4 starten parallel auf Eco (so weit das Budget reicht), Komfort wartet.
- Räume erreichen Eco im Schnitt **~30 % schneller**, weil kein Komfort-Konsum bremst.
- Sobald letzter Raum Eco erreicht, schaltet Phase 2 in **einem** Heartbeat alle berechtigten Räume auf Komfort hoch (Reihenfolge nach Prio).
- Quota-Verbrauch: identisch (1 Call pro echter Setpoint-Änderung).

## Files

- `supabase/functions/pv-automation/index.ts` — Phase-Gate, Phase-2-Bedingung, Plan-Vorausberechnung
- `mem://arch/pv-automation-strategy-v2` — neue Strategie dokumentieren
- `mem://index.md` — Core-Eintrag aktualisieren
