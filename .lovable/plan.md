## Raumübersicht zeigt Aktivierung sofort an (1-Call-Modell)

### Diagnose

Da pro Raum nur **ein Tuya-Call** abgesetzt wird (kein Status-Polling), muss die UI selbst zuverlässig anzeigen:
- **„Eco gesetzt"** — Setpoint-Befehl wurde an Thermostat geschickt (auch wenn Thermostat noch nicht aktiv heizt)
- **„heizt"** — Thermostat hat tatsächlich Heizphase begonnen (aus Logs / `is_heating`)

Gefundene Bugs in `useActiveHeatingRooms.ts`, die das verhindern:

1. **Queue-Detektion sucht falschen Command** — `command='set_temperature'`, edge function schreibt aber `set_target_temp`. → DB-Commands triggern nie ein „Aktiviert"-Badge.
2. **Setpoint-Heuristik zu eng** — verlangt `last_auto_change < 10 min`, was nach Heartbeat-Pause oft schon abgelaufen ist. Außerdem prüft sie nicht, ob `target_temp` tatsächlich auf Eco/Komfort steht (unabhängig vom Zeitpunkt).
3. **Polling 30 s zu träge** — Aktivierung erst nach bis zu 30 s sichtbar.

### Änderungen

**`src/hooks/useActiveHeatingRooms.ts`**
- Command-Filter erweitern auf `['set_target_temp', 'set_temperature']`.
- **Neue Setpoint-Logik (zuverlässig, ohne Zeitfenster):**
  - Raum gilt als „aktiviert" wenn `automation_enabled === true` UND `target_temp >= eco_temp - 0.2` UND `target_temp > night_temp + 0.3`. 
  - Das spiegelt direkt: Automatik hat Setpoint angehoben → Aktivierung läuft, unabhängig wie lange her.
- Polling 30 s → 15 s.

**`src/components/heating/RoomStatusTable.tsx`**
- **Status-Badge erweitern** mit drei klaren Zuständen:
  - **„Heizt · XW"** (rot, Flame) — wenn Logs / `is_heating`=true (wie bisher)
  - **„Eco gesetzt"** / **„Komfort gesetzt"** (blau, Flame-Icon) — wenn `activatedRoomIds.has(room.id)` aber noch nicht physisch heizend (Setpoint geschickt, Thermostat reagiert noch nicht)
  - **„Wartend"** (orange) — `automation_enabled` aber `target_temp <= night_temp` (also noch nicht aktiviert) und Defizit > 0.4°C
  - **„Aus"** (grau) — Default
- Das bestehende `getHeatingStatus` nutzt schon `modeLabel` — wir reichen den `mode.label` durch und zeigen ihn klarer im Aktiviert-Badge an („Eco gesetzt" statt nur „Aktiviert · Eco").

**`src/hooks/useRooms.ts`**
- Polling 30 s → 15 s (damit `target_temp`-Änderung schnell ankommt).

### Effekt

Sobald `pv-automation` einen Eco-Call abgesetzt hat:
- DB-`target_temp` wird sofort auf 19° (Eco) geupdated.
- Innerhalb 15 s sieht der User: **Modus-Badge: Eco**, **Status-Badge: „Eco gesetzt"** (blau, Flame).
- Sobald Tuya-Logs zeigen dass Thermostat tatsächlich heizt: **Status: „Heizt · 800W"** (rot).

So ist immer eindeutig sichtbar:
- ✅ Befehl gesendet (auch wenn Heizung noch nicht startet)
- ✅ Thermostat heizt physisch
- ⏳ Wartend auf Budget
- 💤 Aus
