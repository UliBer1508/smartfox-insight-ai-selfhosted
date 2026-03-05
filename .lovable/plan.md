

# PV-Boost mit raumspezifischen Maximaltemperaturen und Prognose-Tracking

## Problem

1. Raeume werden nicht ueber `comfort_temp` hinaus aufgeheizt, obwohl massiv PV-Strom eingespeist wird
2. Es gibt keine Obergrenze pro Raum -- ein pauschales `+2°C` waere fuer Schlafzimmer zu viel
3. Die Prognose wird nur morgens geladen, aber nicht im Tagesverlauf gegen die tatsaechliche Produktion geprueft

## Loesung

### 1. DB-Migration: `pv_boost_max_temp` pro Raum + `pv_boost_temp_delta` global

```sql
-- Raum-spezifische Boost-Obergrenze (user-definiert)
ALTER TABLE rooms ADD COLUMN pv_boost_max_temp numeric DEFAULT NULL;

-- Globaler Boost-Delta als Fallback
ALTER TABLE heating_settings ADD COLUMN pv_boost_temp_delta numeric DEFAULT 2;
```

Die raumspezifische `pv_boost_max_temp` hat Vorrang. Wenn nicht gesetzt, gilt `comfort_temp + pv_boost_temp_delta`.

Initiale Werte setzen:
- Schlafzimmer: 21°C max
- Wohnzimmer: 22°C max  
- Buero: 21°C max
- Andere: comfort_temp + 2°C

### 2. PV-Boost-Logik in `pv-automation/index.ts`

Nach dem bestehenden Budget-Override-Block (Zeile ~1286) eine neue Stufe einfuegen:

**Energiebudget-Berechnung** (einmal pro Aufruf):
```text
availableHeatingKwh = expectedPvKwh
  - (battery_capacity * (1 - currentSoc/100))  // nur was Batterie noch braucht
  - hotwater_kwh (wenn enabled)
  - car_kwh (wenn enabled)
```

**Prognose-Korrektur im Tagesverlauf:**
- Vergleiche bisherige tatsaechliche PV-Produktion mit dem Prognose-Anteil fuer die bisherigen Stunden
- Wenn tatsaechlich < 70% der erwarteten Produktion: Boost reduzieren/deaktivieren
- Wenn tatsaechlich > 90%: Boost voll erlauben

**Boost-Bedingungen:**
- `availableHeatingKwh > 10` UND Prognose-Korrektur positiv
- Raum bereits >= `comfort_temp` (normaler Heizbedarf gedeckt)
- `gridExport > 1000W` ODER `batterySoc > 70%`
- Raum hat `pv_auto_enabled = true`
- Raumtemperatur < `boostMaxTemp` (raumspezifisch!)

**Boost-Zieltemperatur:**
```text
boostMaxTemp = room.pv_boost_max_temp ?? (comfortTemp + settings.pv_boost_temp_delta)
targetTemp = Math.min(boostMaxTemp, comfortTemp + boostDelta)
```

**Deaktivierung:**
- Raumtemp >= boostMaxTemp
- gridExport < 300W UND batterySoc < 50%
- Prognose-Korrektur zeigt Unterproduktion

### 3. Type + Hook Updates

- `Room` interface: `pv_boost_max_temp?: number | null`
- `HeatingSettings` interface: `pv_boost_temp_delta?: number`
- `useHeatingSettings` Default: 2

### 4. UI: Raumspezifische Boost-Grenze in RoomManager

Im Raum-Bearbeitungsdialog ein Feld "PV-Boost Max" (z.B. Slider 0-25°C oder leer fuer Default).

### 5. UI: Globaler Boost-Delta in HeatingSettingsForm

Neues Feld "PV-Boost Temperatur" (0-5°C, Default 2°C) mit Erklaerung.

## Betroffene Dateien

1. `supabase/migrations/` -- 2 neue Felder (rooms + heating_settings)
2. `supabase/functions/pv-automation/index.ts` -- Energiebudget + Prognose-Korrektur + Boost-Logik
3. `src/types/room.ts` -- `pv_boost_max_temp`
4. `src/types/heating.ts` -- `pv_boost_temp_delta`
5. `src/hooks/useHeatingSettings.ts` -- Default
6. `src/components/heating/HeatingSettingsForm.tsx` -- Globaler Boost-Slider
7. `src/components/heating/RoomManager.tsx` -- Boost-Max pro Raum

## Erwartetes Ergebnis

Bei 76 kWh Prognose: ~58 kWh Heizbudget. Raeume werden gezielt aufgeheizt -- Wohnzimmer auf max 22°C, Schlafzimmer/Buero auf max 21°C. Im Tagesverlauf wird die Prognose gegen die Realitaet geprueft und der Boost angepasst.

