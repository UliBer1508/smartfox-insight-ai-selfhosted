

## Plan: PV-Tagesprognose für Eco-Planung + Prognose-Bug-Fix

### Problem
1. **Bug**: Die `forecastAccuracy`-Berechnung (Zeile 901-903) sucht nach Keys wie `"7"`, `"8"`, aber die `hourly_watts` Keys sind `"2026-04-12 07:00:00"` → `forecastSoFarWh` ist immer 0, Accuracy immer 1.0
2. **Fehlende Tagesplanung**: Das System plant nicht voraus. Morgen stehen nur 25.6 kWh zur Verfügung — das System muss berechnen ob das für alle Eco-Räume reicht und die Räume entsprechend priorisieren
3. **Kein Mindest-Budget bei niedriger PV**: Morgens bei wenig PV (z.B. 500W) wird nicht geheizt, obwohl die Tagesprognose genug Energie verspricht

### Änderungen in `supabase/functions/pv-automation/index.ts`

**1. Bug-Fix: hourly_watts Key-Format korrigieren** (Zeile 901-903)
```typescript
// Vorher (defekt):
const key = String(h);
// Nachher (korrekt):
const key = `${today} ${h.toString().padStart(2, '0')}:00:00`;
```

**2. Verbleibende PV-Energie für heute berechnen** (neue Berechnung nach Zeile 923)
- Aus `hourly_watts`: Summe aller Stunden ab jetzt bis Sunset
- Korrigiert mit `forecastAccuracy`
- Abzüglich Grundlast (500W × verbleibende Stunden)
- Ergebnis: `remainingPvForHeatingWh`

```text
Beispiel heute 12:00, Sunset 19:00:
  hourly_watts 12-19 Uhr summiert = ~28 kWh
  × forecastAccuracy (z.B. 0.85) = 23.8 kWh
  - Grundlast (500W × 7h = 3.5 kWh) = 20.3 kWh
  → Für Eco verfügbar: 20.3 kWh

Beispiel morgen (25.6 kWh gesamt):
  - Batterie/WW/Auto-Bedarf abgezogen
  - Rest = verfügbar für Eco-Heizung
```

**3. Eco-Energiebedarf aller Räume berechnen** (neue Berechnung, ~Zeile 945)
- Pro Raum: `(ecoTemp - currentTemp) × energyPerDegreeWh` (aus ML-Features)
- Fallback: `heatingPower × geschätzteDauer`
- `totalEcoEnergyNeededWh` summiert alle Räume unter Eco
- Logging: "Eco-Bedarf: X kWh, PV-Rest: Y kWh → reicht / reicht nicht"

**4. Prognose-basiertes Mindest-Budget für Eco** (Änderung Zeile 963-997)
- Wenn `remainingPvForHeatingWh >= totalEcoEnergyNeededWh`:
  - Eco darf heizen auch bei aktuellem gridExport = 0
  - Mindest-Budget = aktuelle Stunden-Prognose × forecastAccuracy - Grundlast
  - "Die Sonne kommt noch" → sequentielles Heizen erlaubt
- Wenn PV nicht reicht und `afterSunset && SOC > 50%`:
  - Batterie-Reserve für verbleibende Eco-Räume (bestehende Logik)

**5. Batterie-Korrektur differenzieren** (bestehende Logik bleibt)
- Tagsüber: Batterie-Entladung wird vom Budget abgezogen (nur echtes PV nutzen)
- Abend: Eco darf Batterie bis 50% SOC nutzen
- Komfort: immer strikt PV-only

### Erwartetes Verhalten

```text
Heute (44.8 kWh Prognose):
  08:00, PV 1400W, gridExport 300W:
  → Eco-Bedarf: 3 kWh, PV-Rest: 30 kWh → genug!
  → Mindest-Budget aus Stunden-Prognose: ~1400W - 500W = 900W
  → 1 Raum heizt sequentiell

Morgen (25.6 kWh Prognose):
  08:00, PV niedrig:
  → Eco-Bedarf: 3 kWh, PV-Rest: 18 kWh → reicht
  → Räume sequentiell auf Eco heizen
  → Kein Komfort-Boost (zu wenig Tagesenergie)

  19:30, kein PV, 1 Raum noch unter Eco, SOC 65%:
  → Batterie-Reserve freigegeben
  → Raum wird auf Eco gebracht
```

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen 895-1017

