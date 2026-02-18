

# Batterie-Schutz aus PV-Automation entfernen

## Problem
Die PV-Automation senkt nachts alle Raumtemperaturen um 2 Grad C ab wenn die Batterie unter 30% SOC faellt. Das betrifft aktuell alle 12 Raeume - sie werden auf night_temp minus 2 Grad C gesetzt statt auf die konfigurierte night_temp.

**Beispiel Bad Uli:** night_temp = 20 Grad C, aber Thermostat steht auf 18 Grad C wegen "Batterie-Schutz".

## Ursache
Zeile 1004-1006 in `pv-automation/index.ts`:
```text
const batteryLow = batterySoc !== null && batterySoc < 30;
const effectiveNightTemp = batteryLow ? Math.max(nightTemp - 2, 15) : nightTemp;
```

## Warum entfernen
- Der Batterie-Schutz ist bereits in der Fronius/Smartfox-Hardware eingebaut
- Die PV-Automation kann und soll die Batterie nicht steuern
- Raeume sollen immer auf ihrer eingestellten Temperatur heizen (night_temp nachts, eco_temp tagsueber)

## Aenderung in `supabase/functions/pv-automation/index.ts`

### Stelle 1: Batterie-Schutz-Logik entfernen (Zeilen 1004-1018)

Vorher:
```text
const batteryLow = batterySoc !== null && batterySoc < 30;
const effectiveNightTemp = batteryLow ? Math.max(nightTemp - 2, 15) : nightTemp;

const needsCorrection = currentTargetTemp !== effectiveNightTemp || room.pv_auto_active;

// ... Log und Korrektur auf effectiveNightTemp
if (needsCorrection) {
  targetTemp = effectiveNightTemp;
  reasoning = batteryLow ? "Batterie-Schutz..." : "Nachtmodus...";
}
```

Nachher:
```text
const needsCorrection = currentTargetTemp !== nightTemp || room.pv_auto_active;

// ... Log und Korrektur direkt auf nightTemp
if (needsCorrection) {
  targetTemp = nightTemp;
  reasoning = "Nachtmodus bis [nightEnd] (Wien: [wienTime])";
}
```

Die Variable `batteryLow` und `effectiveNightTemp` werden komplett entfernt. Raeume bekommen nachts immer ihre konfigurierte `night_temp`.

## Ergebnis nach Aenderung

| Raum | night_temp | Neues target_temp |
|------|-----------|-------------------|
| Bad Uli | 20 Grad C | 20 Grad C |
| Wohnzimmer | 20 Grad C | 20 Grad C |
| Zimmer Uli | 20 Grad C | 20 Grad C |
| Buero | 18 Grad C | 18 Grad C |
| Wirtschaftsraum | 18 Grad C | 18 Grad C |

