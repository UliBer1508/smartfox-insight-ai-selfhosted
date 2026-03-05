
# ✅ PV-Boost mit raumspezifischen Maximaltemperaturen und Prognose-Tracking

## Implementiert

### DB-Felder
- `rooms.pv_boost_max_temp` - Raumspezifische Boost-Obergrenze (nullable)
- `heating_settings.pv_boost_temp_delta` - Globaler Boost-Delta (Default: 2°C)

### Initiale Werte gesetzt
- Wohnzimmer: 22°C max
- Schlafzimmer/Büro: 21°C max

### PV-Boost-Logik in `pv-automation/index.ts`
- Energiebudget: `Prognose - Batterie-Bedarf - Warmwasser - Auto = Heizbudget`
- Prognose-Tracking: Vergleicht tatsächliche PV-Produktion mit Stunden-Prognose
- Boost aktiv wenn: Budget > 10kWh UND Prognose-Genauigkeit >= 70%
- Boost-Bedingungen: Raum >= comfort_temp, Export > 1000W oder SOC > 70%
- Raumspezifische Max-Temp hat Vorrang vor globalem Delta

### UI
- HeatingSettingsForm: "PV-Boost Temperatur" Feld (0-5°C)
- RoomManager: "PV-Boost Max °C" pro Raum (nur bei PV-Auto aktiv)
