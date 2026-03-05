
# ✅ Solar-Heiztemperatur entfernt, PV-Boost ist jetzt primäre Logik

## Umgesetzt

### Problem behoben
- `solar_heating_temp` senkte Thermostate auf 18°C bei Sonne → verhinderte PV-Boost
- Widerspruch: PV-Boost will HÖHER heizen, solar_heating_temp setzte NIEDRIGER

### Änderungen
1. **pv-automation/index.ts**: Alle `solarTemp`-Referenzen entfernt
   - Echtzeit-Solargewinn: Thermostat bleibt auf eco_temp (statt Absenkung)
   - PV-Überschuss: Alle Räume einheitlich auf eco_temp (statt solar_heating_temp)
   - Warte auf PV: action='keep' statt 'deactivate' mit solarTemp
   - PV-Modus aktiv: eco_temp für alle Räume (keine Unterscheidung solar/normal)

2. **RoomManager.tsx**: "Solar-Heiztemperatur" Feld aus UI entfernt

3. **room.ts**: `solar_heating_temp` als @deprecated markiert

### Logik jetzt
| Situation | Temperatur |
|-----------|-----------|
| Nacht | night_temp |
| Tag, wenig PV | eco_temp |
| Tag, PV-Überschuss | eco_temp → comfort_temp (Budget) |
| Tag, viel PV-Überschuss | pv_boost_max_temp (über comfort) |
| Solargewinn durch Fenster | eco_temp (Heizung geht nicht an, da Raum warm) |
