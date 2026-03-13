

# PV-Überschuss optimal nutzen: Stufenweise Heizung ohne Netzstrom

## Problem

1. **Budget falsch berechnet**: `pvPower - baseLoad` (Zeile 687) schätzt 500W Grundlast, aber der reale Verbrauch schwankt. Bei 8000W PV und 3000W Verbrauch wird ein Budget von 7700W berechnet statt der echten 5000W Export — Differenz kommt vom Netz.

2. **Comfort ohne Prüfung der Raumleistung**: `gridExport > 500` (Zeile 1209) erlaubt comfort_temp egal ob der Export die Heizleistung des Raums (800-1200W) deckt.

3. **Kein Super-Comfort**: Wenn Batterie voll, Warmwasser fertig und alle Räume auf comfort — wird der Überschuss eingespeist statt Räume +1°C über comfort zu heizen.

4. **Consumer-Priorität nicht geprüft**: Es wird nicht berücksichtigt ob Batterie voll ist und Warmwasser geheizt wurde.

## Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

### A. Budget auf gridExport basieren (Zeile 684-694)

```typescript
if (pvPower > 500) {
  budgetMode = 'pv_optimized';
  // gridExport = tatsächlicher Überschuss nach ALLEN Verbrauchern
  availableBudget = Math.max(0, gridExport + powerBudgetTolerance);
} else {
  budgetMode = 'grid_sequential';
  availableBudget = 0;
}
```

### B. Stufenlogik im PV-Optimized Block (Zeile 1203-1221)

Neue 4-Stufen-Logik:

```
Stufe 1: Raum < eco_temp → auf eco_temp heizen (wenn gridExport >= heatingPower)
Stufe 2: Raum bei eco, gridExport >= heatingPower, Batterie > 95%, kein aktives WW
         → auf comfort_temp heizen
Stufe 3: Alle Räume >= comfort_temp, gridExport >= heatingPower, Batterie > 95%
         → Raum mit höchster Priorität +1°C (max comfort+1°C)
Stufe 4: Sonst → halten, kein Heizen
```

Jede Stufe prüft `gridExport >= raumHeizleistung` — damit wird nie mehr Strom verbraucht als tatsächlich exportiert wird.

### C. Consumer-Priorität prüfen

Vor der Komfort-/Super-Komfort-Stufe werden Batterie-SOC und Warmwasser-Status aus den bereits geladenen Daten geprüft:
- `batterySoc` (bereits vorhanden, Zeile ~580)
- Warmwasser-Status: aus `consumer_logs` prüfen ob aktuell aktiv (`is_active = true, consumer_type = 'hotwater'`)

### D. Super-Comfort: +1°C über comfort bei vollem Überschuss

Neue Logik nach dem Budget-Override-Block (nach Zeile 1233):
- Bedingungen: Batterie > 95%, kein aktives Warmwasser, `gridExport > heatingPower`, Raum bereits bei comfort_temp
- Setzt `targetTemp = comfort_temp + 1` (max. comfort + 1°C, hart gedeckelt)
- Nur für den Raum mit der höchsten Priorität (sequenziell, einer nach dem anderen)
- Prüft ob ALLE Räume bereits auf comfort sind bevor Super-Comfort aktiviert wird

### E. Deckelung anpassen (Zeile 1240-1243)

Von `comfort_temp` auf `comfort_temp + 1` ändern, aber nur wenn Super-Comfort-Bedingungen erfüllt sind. Sonst bleibt comfort_temp das Maximum.

## Technische Details

### gridExport als Budget-Basis
`gridExport` (Zeile 666) = `-power_io` wenn `power_io < 0`. Das ist der tatsächliche Strom der gerade ins Netz fließt — nach Abzug ALLER Verbraucher (Haushalt, Warmwasser, Batterie-Laden). Damit ist die Budget-Berechnung exakt.

### Warmwasser-Check
Aus `consumer_logs` mit `consumer_type = 'hotwater'` und `is_active = true` prüfen. Alternativ: Warmwasser läuft typisch wenn Leistung > `hotwater_power_w` (2800W) vom Verbrauch abgeht — aber die DB-Prüfung ist zuverlässiger.

### Sequenzielles Heizen bleibt erhalten
Die Budget-Runden 1+2 (Zeile 743-808) bleiben unverändert — sie stellen sicher dass nur so viele Räume gleichzeitig heizen wie das Budget erlaubt. Durch `gridExport` als Basis wird das Budget korrekt limitiert.

## Erwartetes Ergebnis
- **Ohne PV**: Kein Heizen (0W Budget)
- **Mit PV, kleiner Export**: Sequenziell ein Raum auf eco_temp
- **Großer Export, Batterie voll, WW fertig**: Sequenziell Räume auf comfort_temp
- **Alle auf comfort, immer noch Export**: Prioritäts-Raum bekommt +1°C
- **Nie Netzstrom**: Budget = gridExport, jeder Raum nur aktiviert wenn Export >= Heizleistung

