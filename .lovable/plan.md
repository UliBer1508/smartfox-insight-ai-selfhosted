

## Plan: Watt-Anzeige in der Raum-Übersicht

### Was sichtbar werden soll
In der Spalte **"Heizung"** der Raum-Übersicht zusätzlich zur Anzeige `● Heizt` / `● Aus` / `● Wartend` die **aktuelle Leistung in Watt** anzeigen — aber nur wenn der Raum tatsächlich heizt.

### Datenquelle
Die effektive Heizleistung kommt aus `getEffectiveHeatingPower(room)` (in `src/types/room.ts`, bereits vorhanden):
- Priorität 1: `calculated_power_w` (wenn Konfidenz ≥70% & Samples ≥5)
- Priorität 2: `heating_power_w` (manuell)
- Priorität 3: `floor_area_m2 × 80W` (Schätzung)

### Anzeige-Verhalten

| Status | Anzeige Desktop | Anzeige Mobil |
|---|---|---|
| **Heizt** | `● Heizt · 850W` (rot) | `● Heizt · 850W` (rot) |
| **Wartend** | `● Wartend` (orange, unverändert) | unverändert |
| **Aus** | `● Aus` (grau, unverändert) | unverändert |

Falls Leistung = 0 (kein Wert ableitbar) → nur "Heizt" ohne Watt.

### Bonus: Footer-Summe (optional)
Unter der Tabelle eine kleine Zeile: **"Aktuell heizen: 3 Räume · 2.140 W"** — gibt sofort Überblick über die Gesamt-Heizleistung. Quelle: Summe aller `is_heating === true` Räume.

### Datei

| Datei | Änderung |
|---|---|
| `src/components/heating/RoomStatusTable.tsx` | `getHeatingStatus()` um optionalen `power`-Parameter erweitern, Anzeige in Desktop- und Mobile-Pfad ergänzen, Footer-Zeile mit Summe |

### Kein Eingriff in
- Heizlogik, Automatik, DB-Schema, Tuya-Calls — **rein Anzeige-Layer**
- `SYSTEM_DOCUMENTATION.md` — UI-Mikro-Änderung, kein Konzept-Update nötig

