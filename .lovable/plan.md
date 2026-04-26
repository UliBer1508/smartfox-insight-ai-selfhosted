## Problem (laut Doku & Code-Analyse)

Die Memory `mem://arch/active-heating-status-source` schreibt vor:

> **Die Anzeige aktiver Heizungen basiert primär auf `room_heating_logs` (heating_start/stop), NICHT auf dem `is_heating`-Flag der `rooms`-Tabelle.**

Genau dafür existiert bereits der Hook `useActiveHeatingRooms` (eigene Notiz im File: *"more reliable than the is_heating flag in the rooms table"*).

**Aktueller Verstoß** in `src/components/heating/RoomStatusTable.tsx`:
- Zeile 33: `if (room.is_heating)` → Status-Badge "Heizt"
- Zeile 38: Wenn `is_heating=false` und `target − current > 0.3` → **"Wartend"** (animiert)
- Zeile 100/126/261: `tuyaRooms.filter(r => r.is_heating)` für Header und Power-Anzeige

`is_heating` wird nur durch den Tuya-Cloud-Sync alle 5 min (`SYNC_INTERVAL_MS` in `HeatingDashboard`) bzw. durch die `pv-automation`-Heartbeats aktualisiert. Zwischen den Syncs ist das Flag minutenlang veraltet → Räume die laut Thermostat heizen, erscheinen als „Wartend" oder „Aus", obwohl in `room_heating_logs` längst ein `heating_start` ohne nachfolgenden `heating_stop` steht.

`useActiveHeatingRooms` rekonstruiert dagegen den echten Live-Status aus den Events, pollt alle 30 s und ist damit die korrekte Quelle.

## Lösung

### 1. `src/components/heating/RoomStatusTable.tsx` umbauen
- Hook `useActiveHeatingRooms()` importieren und nutzen.
- Ein Set `activeRoomIds = new Set(activeRooms.map(r => r.room_id))` und Map `activePowerById` aus dem Hook bilden.
- Helper `isRoomActivelyHeating(room)` und `getRoomLivePower(room)` einführen, die ausschließlich diesen Hook auswerten – `room.is_heating` wird im UI nicht mehr gelesen.
- `getHeatingStatus(...)` so anpassen:
  - **„Heizt · NW"** wenn `activeRoomIds.has(room.id)` (Power aus `useActiveHeatingRooms`, mit `getEffectiveHeatingPower` als Fallback).
  - **„Wartend"** nur noch wenn Raum NICHT aktiv heizt UND `target − current > 0.3` UND `automation_enabled` UND kein abgelaufener Override – Schwelle leicht anheben (z. B. > 0.4) damit Hysterese-Zone (±0.3 °C laut `mem://features/heating/thermostat-hysteresis-logic`) nicht fälschlich als „Wartend" erscheint.
  - Sonst „Aus".
- Header-Zeile (Zeile 100–108): aktive Räume und Gesamtleistung aus `useActiveHeatingRooms` (`activeRooms.length`, `totalHeatingPower`) statt aus `is_heating`-Filter.
- Mobile- und Desktop-Render-Pfade an die neuen Helpers anpassen (Zeilen 126, 261).

### 2. Auto-Refresh sicherstellen
- `useActiveHeatingRooms` pollt bereits alle 30 s.
- Der bestehende 5-Min-Auto-Sync in `HeatingDashboard` bleibt für die Cloud-Synchronisation (aktualisiert `current_temp`, `target_temp`); die Live-Heizstatus-Anzeige hängt aber nicht mehr daran.
- Optional: Im `RoomStatusTable` einen kleinen Zeitstempel "Aktualisiert vor X s" anzeigen, damit erkennbar ist dass Werte frisch sind.

### 3. Konsistenz in anderen Komponenten prüfen
Kurzer Check, ob weitere User-sichtbare Komponenten noch das veraltete `is_heating` als primäre Wahrheit verwenden, und ggf. dort dieselbe Umstellung machen:
- `HeatingOverviewCard.tsx`
- `ThermostatCard.tsx` (Heizungs-Indikator)

(Falls Anpassung nötig, in derselben Iteration angleichen — sonst nur dokumentieren.)

### 4. Doku aktualisieren
- `mem://arch/active-heating-status-source` ergänzen: Auch die `RoomStatusTable` (Raum-Übersicht) nutzt jetzt verbindlich `useActiveHeatingRooms` — Listing-Status NIE mehr direkt aus `rooms.is_heating` ableiten.
- `mem://ui/heating/room-status-indicators` aktualisieren: „Wartend"-Definition präzisieren (nur wenn nicht aktiv UND Δ > 0.4 °C UND Automation aktiv).
- `mem://index.md` Core-Zeile zu `Active Heating Source` schärfen, damit zukünftige Sessions die Regel nicht erneut verletzen.

## Erwartetes Ergebnis

- Räume die laut Thermostat aktuell heizen, erscheinen sofort (≤ 30 s) als „Heizt · XW" — kein „Wartend" oder „Aus" mehr während der Cloud-Sync-Lücken.
- „Wartend" zeigt nur noch echte Wartesituationen (Auto an, deutlich unter Ziel, aber Thermostat ruft nicht ab).
- Header „Aktuell heizen: N Räume · X W" ist sekundengenau konsistent mit den einzelnen Status-Badges.
