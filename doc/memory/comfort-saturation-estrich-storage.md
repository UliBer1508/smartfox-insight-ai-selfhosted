---
name: Comfort Saturation Estrich Storage
description: Räume wechseln nach Erreichen der Komforttemperatur zurück auf Eco-Setpoint, Estrich speichert Wärme weiter
type: feature
---

# Komfort-Sättigung mit Estrich-Speicher

## Regel
Sobald `current_temp >= comfort_temp - 0.1` UND `target_temp >= comfort_temp - 0.1`:
- 1 Tuya-Call: Setpoint zurück auf `eco_temp`
- DB: `rooms.comfort_saturated_at = now()`
- Raum gilt für den Rest des Tages als "komfort-gesättigt"

## Re-Komfort-Sperre (Hysterese)
Komfort-gesättigte Räume werden tagsüber NICHT erneut Komfort-Kandidat, **außer** `current_temp < eco_temp - 0.5°C`. Dann darf bei Budget erneut auf Komfort hochgeheizt werden.

## Battery-Full-Override
Bei vollem Akku + großem Echt-Export wird die Sättigungs-Sperre überstimmt:
- Bedingung: `batterySoc ≥ 95%` UND `gridExport ≥ 3000W` UND `expectedPvKwh ≥ 5kWh` UND nicht Nacht.
- `isComfortSaturated()` gibt `false` zurück, solange `current_temp < pv_boost_max_temp − 0.2°C` (Fallback-Cap = `comfort_temp + 1.5°C`).
- Saturation-Pre-Pass markiert Räume NICHT auf Eco zurück, solange Override aktiv und Hardcap nicht erreicht.
- Verhindert Einspeisung/Wechselrichter-Abregelung bei voller Batterie und langem Sonnentag.

## Reset
- Beim Nacht-Modus-Übergang (`night_start_time`): `comfort_saturated_at = NULL`
- Sättigungen vom Vortag werden via Datums-Vergleich (Wien-Zeit) ignoriert.

## Effekt
- Thermostat heizt bei Eco-Setpoint nicht, solange `current_temp >= eco_temp` (interne Hysterese)
- Estrich gibt 2-4h Wärme ab, bevor Raum unter Eco fällt
- Ergebnis: ~50% weniger Komfort-Up/Down-Calls bei wechselhaftem Wetter

## UI
ThermostatCard zeigt Badge "🧱 Estrich-Speicher" wenn `comfort_saturated_at` gesetzt ist.

## Code-Stellen
- `supabase/functions/pv-automation/index.ts` — Phase 2 Sättigungs-Pre-Pass + isComfortSaturated() Helper
- `supabase/functions/pv-automation/index.ts` — Nacht-Block setzt `comfort_saturated_at = null`
- `src/components/heating/ThermostatCard.tsx` — Badge
