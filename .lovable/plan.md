
# Thermostat-Übersichtstabelle im Dashboard

## Ziel
Eine kompakte Tabelle aller Thermostate wird im Dashboard zwischen dem Energiefluss-Diagramm und dem Batterie-Status eingefügt. Die Tabelle zeigt pro Raum: Name, aktuelle Temperatur, Ziel-Temperatur, Heizstatus und Automations-Status.

## Design
Die Tabelle orientiert sich am Screenshot und zeigt folgende Spalten:
- **Raum** - Name des Raums
- **Temp** - Aktuelle Temperatur
- **Ziel** - Ziel-Temperatur
- **Heizung** - An/Aus-Indikator (farbiger Punkt)
- **Auto** - Automations-Status (Haken oder Kreuz)

Die Spalten Device ID, Local Key und Local IP werden weggelassen, da diese eher in die Einstellungen gehoren. Der Fokus liegt auf dem Live-Status.

## Technische Umsetzung

### 1. Neue Komponente: `src/components/heating/ThermostatOverviewTable.tsx`
- Nimmt `rooms: Room[]` als Prop
- Kompakte Card mit Tabelle
- Farbige Punkte fur Heizstatus (rot = An, grau = Aus)
- Gruner Haken / rotes Kreuz fur Automations-Status
- Nur Raume mit `tuya_device_id` werden angezeigt
- Responsives Design fur die schmale linke Spalte

### 2. Einbindung in `src/pages/Index.tsx`
- Import der neuen Komponente
- Platzierung zwischen `EnergyFlowDiagram` (Zeile 180) und `BatteryStatus` (Zeile 182)
- Ubergabe der bereits vorhandenen `rooms`-Daten aus dem `useRooms`-Hook (Zeile 67)

### Datenquelle
Die Room-Daten (`current_temp`, `target_temp`, `is_heating`, `automation_enabled`) sind bereits im `rooms`-State aus dem `useRooms`-Hook verfugbar. Es werden keine zusatzlichen API-Aufrufe benotigt.
