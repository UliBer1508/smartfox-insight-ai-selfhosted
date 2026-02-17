

# Fix: Zimmer muessen auch ohne PV-Strom geheizt werden

## Problem

Die `pv-automation` setzt alle Thermostate auf 15°C wenn:
- Batterie-SOC unter 30% (aktuell der Fall)
- Leistungsbudget erschoepft ist (Rotation/Pause)

15°C bedeutet praktisch: Heizung AUS. Die Raeume kuehlen aus, obwohl der Benutzer z.B. `night_temp = 20°C` konfiguriert hat.

## Loesung

Statt hartem 15°C wird die konfigurierte `night_temp` des Raums verwendet. Bei niedrigem Akku maximal 2°C Absenkung unter `night_temp`, nie unter 15°C.

## Aenderungen in `supabase/functions/pv-automation/index.ts`

5 Stellen werden geaendert:

### A) Nachtmodus Batterie-Schutz (Zeile 464)

Vorher: `effectiveTarget = batteryLow ? 15 : normalNightTarget`
Nachher: `effectiveTarget = Math.max(normalNightTarget - (batteryLow ? 2 : 0), 15)`

Beispiel "Bad Uli" (night_temp=20): 18°C statt 15°C

### B) Nachtmodus Raumanpassung (Zeile 493)

Gleiche Logik wie A) fuer die Schleife die Raeume einzeln anpasst.

### C) Tages-Nachtcheck (Zeile 1005)

Vorher: `effectiveNightTemp = batteryLow ? 15 : nightTemp`
Nachher: `effectiveNightTemp = batteryLow ? Math.max(nightTemp - 2, 15) : nightTemp`

### D) Leistungsbudget Rotation-Stopp (Zeile 1233)

Vorher: `targetTemp = 15` (Rotation)
Nachher: `targetTemp = nightTemp` (Raum bleibt bewohnbar)

### E) Leistungsbudget Budget-Stopp (Zeile 1250)

Vorher: `targetTemp = 15` (Budget erschoepft)
Nachher: `targetTemp = nightTemp` (Raum bleibt bewohnbar)

## Ergebnis

| Situation | Vorher | Nachher |
|---|---|---|
| Nacht + Batterie OK | night_temp (20°C) | night_temp (20°C) - unveraendert |
| Nacht + Batterie leer | 15°C | night_temp - 2°C (18°C) |
| Tag + Budget-Pause | 15°C | night_temp (20°C) |
| Tag + Rotation | 15°C | night_temp (20°C) |

Raeume werden NIE unter ihre konfigurierte Nachttemperatur minus 2°C abgesenkt. Heizung laeuft weiter, nur etwas reduziert.

