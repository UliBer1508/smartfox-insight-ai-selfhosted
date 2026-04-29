## Problem

Das Banner zeigt **"Heizstatus veraltet — letzter Tuya-Sync vor 104 h"** und verschwindet auch nach "Jetzt synchronisieren" nicht — der Wert wird sogar weiter hochgezählt.

### Ursache (durch Datenbank-Analyse bestätigt)

In `useActiveHeatingRooms.ts` (Zeile ~120) wird das Sync-Alter als **Maximum (ältester Sync)** über *alle* Räume mit `tuya_device_id` berechnet:

```ts
if (oldestSyncMs === null || ageMs > oldestSyncMs) oldestSyncMs = ageMs;
```

Dadurch reicht **ein einziger** Raum mit altem Sync, um den Status für alles auf "stale" zu setzen.

In der Datenbank ist genau das passiert:

| Raum | Sync-Alter |
|---|---|
| Bad Uli, Kinder Bad, Zimmer Uli | 0,3 h (frisch) |
| Zimmer Luis | 0,6 h |
| Toilette, Waschraum, Wohnzimmer, Büro, … | ~3 h |
| **Haustür** | **104 h** ← der Übeltäter |

Der Raum "Haustür" hat zwar ein Tuya-Device hinterlegt (`bfaea1c0f312db52321ilc`), wird aber von `push-all-temps` nicht erfolgreich aktualisiert (vermutlich offline / Quota-Fehler), sodass `last_thermostat_sync` bei 25.04. stehen bleibt. Da die Quota-Errors im `setDeviceTemperature`-Catch nur geloggt werden, bleibt der Sync-Stempel ewig alt → Banner bleibt für immer gelb.

Zusätzlich: Beim nächsten Reload wird die Differenz natürlich noch größer ("weiter hochgezählt").

## Lösung

Drei kleine, gezielte Fixes:

### 1. Banner-Logik robuster machen (`src/hooks/useActiveHeatingRooms.ts`)

Statt "ältester Sync gewinnt" auf **Median / 2.-ältester** umstellen, damit ein einzelner toter Thermostat das gesamte Banner nicht mehr triggern kann:

- Sortiere alle `last_thermostat_sync`-Alter aufsteigend
- Verwerfe das oberste 1 Element (oder 10 % bei mehr Räumen) als Ausreißer
- Nimm das Maximum der verbleibenden Werte als `lastSyncAgeSec`

So bleibt das Banner aussagekräftig (wenn 2+ Räume veraltet sind), aber ein einzelner toter Thermostat poisons nicht mehr alles.

### 2. Räume ohne erfolgreichen Push trotzdem als "Sync-Versuch" markieren

In `supabase/functions/tuya-control/index.ts` (`push-all-temps`, Zeile ~1091): Aktuell wird `last_thermostat_sync` nur bei Erfolg gesetzt. Bei Quota-Fehler (60001001) bleibt er ewig alt.

Lösung: Eine neue Spalte ist nicht nötig — wir setzen `last_thermostat_sync` zusätzlich auch bei `quotaExhausted`-Fehlern (denn der Status ist dann "ich habe versucht zu syncen, aber die Cloud hat geblockt — kein Datenproblem"). Bei echten Geräte-Offline-Fehlern lassen wir den Stempel alt, damit das Banner berechtigt warnt.

### 3. "Haustür"-Raum bereinigen (einmaliges DB-Update)

Der Raum "Haustür" (id `b94f15d6-…`) hat `automation_enabled=true`, aber das Gerät reagiert seit 4 Tagen nicht. Nach Bestätigung durch dich:
- Entweder `tuya_device_id` auf `NULL` setzen (wenn das Gerät tot/abgeklemmt ist)
- Oder `automation_enabled=false` (wenn nur temporär)
- Oder `last_thermostat_sync = now()` einmalig zurücksetzen (wenn das Gerät demnächst wieder online kommen soll)

→ Hier brauche ich dein OK, was mit "Haustür" passieren soll.

## Technische Details

**Geänderte Dateien:**
- `src/hooks/useActiveHeatingRooms.ts` — Outlier-tolerante Sync-Age-Berechnung
- `supabase/functions/tuya-control/index.ts` — `last_thermostat_sync` auch bei Quota-Fehlern aktualisieren
- 1 SQL-Migration / Update für den Raum "Haustür" (nach deiner Entscheidung)

**Keine Schema-Änderungen.** Keine neuen Tabellen, keine RLS-Änderungen.

## Frage an dich

Was soll mit "Haustür" passieren?
- (a) Tuya-Device-ID entfernen (Gerät dauerhaft raus)
- (b) Automation deaktivieren (temporär raus)
- (c) Sync-Stempel resetten (Gerät kommt bald wieder online)
- (d) So lassen — Fixes 1 + 2 reichen, das Banner wird auch ohne Cleanup verschwinden
