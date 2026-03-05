

# Solar-Heiztemperatur vs. PV-Boost: Widerspruch auflösen

## Das Problem

Zwei gegensätzliche Konzepte existieren nebeneinander:

1. **Solar-Heiztemperatur** (`solar_heating_temp`): "Sonne scheint → Thermostat RUNTER auf 18°C → Heizung AUS"
2. **PV-Boost** (`pv_boost_max_temp`): "PV-Überschuss → Thermostat RAUF über comfort_temp → Heizung AN"

Die `solar_heating_temp` wurde ursprünglich für Südräume eingeführt, damit bei Sonneneinstrahlung durch Fenster die **elektrische** Heizung ausbleibt und der Raum sich passiv durch die Sonne erwärmt. Aber:

- Die Thermostate wissen nicht woher die Wärme kommt — wenn die Sonne den Raum auf 20°C erwärmt, heizt die Heizung ohnehin nicht (Ziel bereits erreicht)
- Das künstliche Absenken auf 18°C verhindert, dass bei PV-Überschuss höher geheizt wird
- Es widerspricht dem PV-Boost-Ziel: bei Überschuss **mehr** heizen, nicht weniger

## Lösung: `solar_heating_temp` entfernen und durch PV-Boost ersetzen

Die `solar_heating_temp`-Logik wird komplett durch die bestehenden Mechanismen ersetzt:

- **Raum wird durch Sonne erwärmt** → Thermostat ist auf eco_temp/comfort_temp, aber die Heizung springt nicht an weil die Raumtemperatur bereits über dem Ziel liegt (Thermostat-interne Logik)
- **PV-Überschuss vorhanden** → PV-Boost hebt das Ziel über comfort_temp auf pv_boost_max_temp
- **Kein PV** → Grid-Fallback heizt auf eco_temp

Das `solar_limit_temp` Feld (maximale Temperatur bei passivem Solargewinn) bleibt bestehen — es begrenzt wie warm ein Raum durch die Sonne werden darf bevor das System reagiert.

### Änderungen

**`supabase/functions/pv-automation/index.ts`:**
- Alle Stellen wo `solarTemp` als Absenkziel verwendet wird (~6 Stellen) durch `ecoTemp` oder `nightTemp` ersetzen
- Solar-Passiv-Logik vereinfachen: statt "Thermostat runter damit Heizung aus" → normales Ziel beibehalten, Thermostat regelt selbst
- Echtzeit-Solargewinn-Erkennung bleibt, aber setzt nicht mehr auf niedrige Temperatur

**`src/components/heating/RoomManager.tsx`:**
- "Solar-Heiztemperatur" Feld aus dem Raum-Dialog entfernen

**`src/types/room.ts`:**
- `solar_heating_temp` Feld als deprecated markieren (DB-Spalte bleibt, wird aber nicht mehr genutzt)

### Ergebnis

| Situation | Vorher | Nachher |
|-----------|--------|---------|
| Sonne scheint, PV-Überschuss | Thermostat auf 18°C (Heizung aus) | Thermostat auf comfort_temp oder pv_boost_max_temp |
| Sonne erwärmt Raum passiv über Ziel | Thermostat auf 18°C | Thermostat auf eco_temp, Heizung geht nicht an (Raum schon warm) |
| Kein PV | Grid-Fallback eco_temp | Grid-Fallback eco_temp (unverändert) |

