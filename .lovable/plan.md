

# Raum-Uebersicht als Tabelle im Dashboard

## Was wird gebaut

Eine kompakte Raum-Status-Tabelle im Energie-Dashboard (Tab "Dashboard"), platziert oberhalb des Leistungsverlauf-Charts (`EnergyChart`). Die Tabelle zeigt alle Raeume mit Tuya-Thermostaten in einer uebersichtlichen Tabellenform, aehnlich dem Screenshot.

## Spalten der Tabelle

| Spalte | Daten | Darstellung |
|--------|-------|-------------|
| Raum | `room.name` | Text |
| Device ID | `room.tuya_device_id` | Gruenes Haekchen wenn vorhanden, sonst rotes X |
| Local Key | `room.local_key` | Gruenes Haekchen wenn vorhanden, sonst rotes X |
| Local IP | `room.thermostat_local_ip` | IP-Adresse als Text |
| Temp | `room.current_temp` | Temperatur in Grad |
| Ziel | `room.target_temp` | Zieltemperatur in Grad |
| Heizung | `room.is_heating` | Roter Punkt + "An" oder grauer Punkt + "Aus" |
| Auto | `room.automation_enabled` | Gruenes Haekchen oder rotes X |

## Platzierung

Im Energy-Dashboard (`src/pages/Index.tsx`), innerhalb der rechten Spalte (lg:col-span-2), direkt **vor** dem `<EnergyChart>` -- also zwischen `EnergyStats` und `EnergyChart`.

## Technische Umsetzung

### Neue Datei: `src/components/heating/RoomStatusTable.tsx`
- Erhaelt `rooms: Room[]` als Props
- Kompakte Tabelle mit `@/components/ui/table`
- Farbige Status-Indikatoren (Check/X Icons, farbige Punkte)
- Responsive: auf Mobile als horizontale Scroll-Tabelle
- Wird nur angezeigt wenn mindestens 1 Raum mit `tuya_device_id` existiert

### Aenderung: `src/pages/Index.tsx`
- Import der neuen `RoomStatusTable` Komponente
- `rooms` Array wird bereits im Index geladen (via `useRooms`)
- Einfuegen der Tabelle vor `<EnergyChart readings={readings} />`

### Dateien zu aendern
1. **Neu**: `src/components/heating/RoomStatusTable.tsx` -- Die Tabellen-Komponente
2. **Editiert**: `src/pages/Index.tsx` -- Import + Einbinden der Tabelle (1 Import + ca. 3 Zeilen)

