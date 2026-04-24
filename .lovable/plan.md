

## Befund: Warum kein Komfort trotz 9,3 kW Überschuss

Aktueller Zustand laut DB und Logs:
- Export: **9,3 kW**, PV: **10,4 kW**, Verbrauch: **769 W**, Batterie: **100% (voll)**
- Alle Räume haben `pv_auto_enabled = true`, `automation_enabled = true`, kein `heating_paused_reason`
- SOC-Gate offen (100% > 80%)

Trotzdem zeigen die Logs für **alle** Räume nur Phase 1 (Eco) — nie Phase 2 (Komfort). Beispiele:
- `Wohnzimmer: ✅ Eco erreicht (21.7°C), kein Komfort-Budget` → Komfort wäre 22°C, müsste also weiter heizen
- `Büro: ✅ Eco erreicht (20.4°C)` → Komfort 21°C, müsste weiter
- `Bad Uli/Zimmer Uli/Luis/Luca/Kinder Bad: Phase 1: Eco 21°C` → bleibt strikt auf Eco-Ziel, obwohl Komfort 22°C wäre

### Ursachen-Analyse

**1. Komfort-Budget wird auf 0 gesetzt — wahrscheinlich durch Komfort-Hard-Lock**

Laut Memory `pv-automation-budget-logic-v2`:
> **Komfort-Hard-Lock (immer aktiv):** Sobald `batterySoc < heatingMinSoc` → `comfortBudget = 0`

Der SOC ist bei **100%**, also dürfte der Lock NICHT greifen. Trotzdem sehen wir kein Komfort. Das deutet auf einen Bug in der Komfort-Budget-Berechnung hin: Vermutlich wird `comfortBudget` aktuell aus etwas anderem als reinem `gridExport` berechnet (z.B. wird `currentlyHeatingPower` falsch abgezogen, weil `is_heating=false` für alle, also `currentlyHeatingPower=0`, und dann eine andere Subtraktion das Budget auf 0 zieht).

**2. „Eco erreicht" stoppt Komfort-Upgrade vorzeitig**

Bei Räumen wie Wohnzimmer (21.7°C bei Eco=21°C, Komfort=22°C) und Büro (20.4°C bei Eco=20°C, Komfort=21°C) wird die Logik mit `✅ Eco erreicht, kein Komfort-Budget` beendet. Das heißt: Sobald Eco erreicht ist, wird gar nicht mehr geprüft, ob Komfort-Budget vorhanden wäre. Das ist die falsche Reihenfolge laut Strategie v2 — Phase 2 soll explizit nach Phase 1 evaluiert werden.

**3. „SKIP - already at 21°C" blockiert Komfort-Upgrade**

Räume wie Bad Uli, Zimmer Uli/Luis/Luca, Kinder Bad zeigen:
> `SKIP - already at 21°C, state=active`

Sie sind bereits auf Eco-Sollwert 21°C (≠ Komfort 22°C). Der Code skipt aber komplett, statt zu prüfen: „Sollwert ist nur Eco — Komfort wäre höher — gibt es Komfort-Budget?" → niemals Upgrade auf 22°C.

**4. Bad Uli/Zimmer Uli haben aktiven manual_override**

`manual_override_until = 2026-04-22` — das liegt **in der Zukunft** (heute ist 2026-04-24, also eigentlich abgelaufen). 22.04 < 24.04, also abgelaufen, kein Override mehr aktiv. Trotzdem prüfen, dass die Logik abgelaufene Overrides nicht fälschlich als aktiv liest.

### Lösung

**Fix A: Komfort-Phase auch bei „Eco erreicht" prüfen**
Im 2-Phasen-Branch in `pv-automation/index.ts`: Wenn `currentRoomTemp >= ecoTarget` UND `comfortTemp > ecoTarget` UND `comfortBudget > roomPower` → Upgrade auf Komfort, statt early-return mit „kein Komfort-Budget".

**Fix B: SKIP-Logik darf Komfort-Upgrade nicht blockieren**
„SKIP — already at 21°C" darf nur greifen, wenn der Sollwert bereits Komfort-Niveau hat. Wenn aktueller Sollwert = Eco UND Komfort wäre höher UND Budget reicht → Sollwert auf Komfort hochsetzen.

**Fix C: Komfort-Budget-Berechnung verifizieren und loggen**
Aktuell loggt das System nicht, **welcher Wert** für `comfortBudget` berechnet wurde. Klar machen: bei 9,3 kW Export und 100% SOC sollte Komfort-Budget ≈ 9300 W sein. Logging-Zeile pro Raum hinzufügen: `comfortBudget=X W, roomPower=Y W, decision=Z`. So sieht man sofort, ob es ein Berechnungs-Bug oder ein Verzweigungs-Bug ist.

**Fix D: Abgelaufene `manual_override_until` zuverlässig ignorieren**
Sicherstellen, dass `manual_override_until < now()` als „kein Override" behandelt wird (in Wien-Zeit).

### Konkrete Dateien

- `supabase/functions/pv-automation/index.ts`
  - 2-Phasen-Entscheidungsblock (Eco → Komfort Übergang)
  - SKIP-Branch erweitern um Komfort-Check
  - Komfort-Budget-Logging
  - Manual-override Vergleich strikt gegen `now()`
- Memory-Update: `mem://arch/pv-automation-strategy-v2` mit der korrigierten Eco→Komfort-Übergangslogik

### Erwartetes Verhalten nach Fix

Bei 9,3 kW Export und vollem Akku:
- Wohnzimmer (21.7°C, Komfort 22°C) → Sollwert 22°C
- Büro (20.4°C, Komfort 21°C) → Sollwert 21°C
- Bad Uli, Zimmer Uli/Luis/Luca, Kinder Bad → Sollwert 22°C statt 21°C
- Räume mit Komfort = Eco bleiben unverändert

### Nicht enthalten / Risiken

- Tuya-Quota ist erschöpft (203/200) → die neuen Komfort-Sollwerte können möglicherweise nicht sofort gesendet werden. Das ist ein separates Thema (bereits adressierter Reserve-Mechanismus für Stop-Befehle gilt nicht für Heizen-hoch). Sobald die Quota nachts resettet, greift die neue Logik korrekt.
- Keine DB-Migration, keine Frontend-Änderung.

