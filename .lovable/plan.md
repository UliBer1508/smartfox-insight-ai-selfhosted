
# Ziel
In der Raum-Übersicht (`RoomStatusTable.tsx`) klar erkennbar machen, **welche Räume die Automatik aktuell auf Heizen geschaltet hat** — auch wenn der Thermostat physisch noch keine Rückmeldung „Heizt" geliefert hat (z. B. wegen Tuya-Quota-Lag oder weil der Befehl gerade erst gesendet wurde).

# Problem heute
Aktuell gibt es nur 3 Status-Badges:
- **Heizt** (rot) — Hardware bestätigt aktive Heizung über `useActiveHeatingRooms` (Logs oder `is_heating`).
- **Wartend** (orange) — `automation_enabled` + 0.4 °C unter Ziel.
- **Aus** (grau) — Rest.

→ Wenn die `pv-automation` einen Raum gerade **per Setpoint-Erhöhung auf Eco/Komfort gestellt** hat (also den Heizbefehl geschickt hat), ist das nirgends sichtbar, solange der Thermostat noch nicht zurückmeldet. Räume erscheinen fälschlich als „Aus" oder „Wartend", obwohl die Automatik sie gerade aktiv freigegeben hat.

# Lösung: Neue Status-Stufe "Aktiviert" + Quellen-Logik

## 1. Neuer Status "Aktiviert" (zwischen Wartend und Heizt)
Definition: Ein Raum gilt als **„Aktiviert"** (= auf Heizen gestellt durch Automatik), wenn **eine** dieser Bedingungen gilt:

a) **Geplante Aktivierung aus `parallel_heating_capacity`**: Raum-ID in `planned_eco_room_ids` ODER `planned_comfort_room_ids` (kommt aus `useParallelHeatingCapacity`, wird von `pv-automation` jeden Lauf geschrieben).

b) **Aktueller Setpoint deutlich über Nacht-Niveau**: `target_temp ≥ eco_temp − 0.2 °C` (Raum ist also auf Eco oder höher gestellt) UND `automation_enabled = true` UND die Automatik hat in den letzten 10 min etwas geändert (`last_auto_change` < 10 min ODER `last_thermostat_sync` zeigt frischen Schreibvorgang).

c) **Pending Command in der Queue**: ein offener Eintrag in `thermostat_commands` mit `status = 'pending'` und `command = 'set_temperature'` für diesen Raum (relevant im Local-Modus).

→ Wenn zusätzlich der Hook einen aktiven Heiz-Zyklus meldet, wird **„Heizt"** angezeigt (höhere Priorität). „Aktiviert" ist also der Zwischenzustand „Befehl raus, Hardware-Echo noch nicht da".

## 2. Visuelles Design
- **Badge-Farbe**: blau (`bg-blue-500/10 text-blue-600`) mit kleinem Pfeil-/Flammen-Icon (`Flame` von lucide), nicht animiert.
- **Label**: `Aktiviert · Eco` oder `Aktiviert · Komfort` (Modus aus aktuellem `target_temp` ableiten — die `getHeatingMode()`-Logik existiert bereits).
- **Tooltip** auf dem Badge: kurzer Text *„Automatik hat den Raum auf {Mode} gestellt (Quelle: Plan / Setpoint / Queue). Wartet auf Hardware-Bestätigung."*

## 3. Status-Hierarchie (von oben nach unten)
1. **Heizt** (rot) — Hardware aktiv (unverändert)
2. **Aktiviert** (blau, NEU) — Automatik hat geschaltet, Hardware-Echo offen
3. **Wartend** (orange) — Automatik aktiv, deutlich unter Ziel, aber kein aktueller Schaltbefehl (= Raum „in Warteschlange" für nächsten Plan)
4. **Aus** (grau) — Rest

## 4. Geänderte Dateien

### `src/hooks/useActiveHeatingRooms.ts`
- Erweitern um ein zweites Set `activatedRoomIds: Set<string>` mit Räumen aus Bedingung (a/b/c).
- Liest zusätzlich:
  - `system_settings` Key `parallel_heating_capacity` (Felder `planned_eco_room_ids`, `planned_comfort_room_ids`)
  - `thermostat_commands` mit `status='pending'` und `command='set_temperature'` der letzten 5 min
  - `rooms.last_auto_change`
- Liefert `activatedRoomIds` und `getActivationReason(roomId): 'plan'|'setpoint'|'queue'|null` zusätzlich zurück.

### `src/components/heating/RoomStatusTable.tsx`
- Neue `getHeatingStatus()`-Variante mit zusätzlichem Parameter `isActivated: boolean` und `activationReason`.
- Neuer Badge-Branch zwischen „Heizt" und „Wartend":
  ```tsx
  if (isActivated) return { 
    label: `Aktiviert · ${mode.label}`, 
    dotClass: 'bg-blue-500', 
    badgeClass: 'bg-blue-500/10 text-blue-600',
    icon: Flame
  };
  ```
- Tooltip mit Quelle der Aktivierung.
- Im Header-Strip zusätzlich Zähler ergänzen: *„Aktuell heizen: 2 · Aktiviert: 3 · Wartend: 1"*.

### `mem://ui/heating/room-status-indicators` (Update)
Neue Status-Stufe „Aktiviert" mit Definitionen ergänzen, Hierarchie dokumentieren.

### `mem://features/heating/activated-vs-heating-distinction.md` (neu)
Erklärt den Unterschied „Aktiviert" (Algorithmus-Befehl raus) vs. „Heizt" (Hardware-Bestätigung) und welche 3 Quellen die Aktivierung erkennen.

## 5. Was ich NICHT ändere
- `useActiveHeatingRooms`-Kerncascade A/B/C bleibt unverändert (das ist die Heizt-Quelle).
- Komfort-/Eco-Budget-Logik in `pv-automation` bleibt unverändert.
- `room_heating_logs` werden weiter wie bisher geschrieben.

# Effekt für dich
Sobald du in der Raum-Übersicht schaust, siehst du:
- 🔴 **Heizt** — Thermostat heizt physisch
- 🔵 **Aktiviert · Komfort** — Automatik hat den Setpoint hochgesetzt, Befehl ist raus (Plan/Setpoint/Queue), aber Hardware meldet noch nicht zurück
- 🟠 **Wartend** — Raum sollte heizen, aber Automatik hat aktuell nichts geschaltet (z. B. wegen Quota oder Budget-Limit)
- ⚪ **Aus** — keine Aktivität

Damit ist der Tuya-Quota-Lag transparent: Räume springen bei einem Algorithmus-Lauf sofort auf 🔵 Aktiviert, und werden zu 🔴 Heizt, sobald die Cloud die Bestätigung liefert.
