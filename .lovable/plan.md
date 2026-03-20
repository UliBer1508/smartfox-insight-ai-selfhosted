
Ziel: Priorität muss zuverlässig gespeichert werden, die Liste sofort korrekt sortieren, und jede Priorität darf nur genau einmal vergeben sein.

Ist-Zustand (gefunden):
- Speichern auf Prio 11/12 schlägt fehl (DB-Fehler 23514), weil `rooms_priority_check` aktuell noch `<= 10` erzwingt.
- In den Daten gibt es bereits doppelte Prioritäten (z. B. 9 und 10 doppelt).
- Frontend macht optimistisches Update, aber ohne sauberen Fehler-Rollback für Prioritätskonflikte.

Umsetzungsplan

1) Datenbank-Regeln korrigieren (Schema + Datenkonsistenz)
- Check-Constraint für `rooms.priority` auf `1..12` anheben.
- Bestehende doppelte Prioritäten einmalig bereinigen (deterministisch in gewünschte Reihenfolge bringen, damit 1–12 eindeutig sind).
- Danach Unique-Constraint auf `rooms(priority)` setzen, damit keine doppelte Prio mehr gespeichert werden kann.

2) Prioritäts-Speichern robust machen (mit Rollback)
- `useRooms.saveRoom` so erweitern, dass der Aufrufer Erfolg/Fehler sicher erkennen kann (statt Fehler nur intern „wegzutoasten“).
- Bei Prioritäts-Update:
  - alten Wert merken,
  - lokal optimistisch setzen (für sofortige Sortierung),
  - DB-Update ausführen,
  - bei Fehler rollback auf alten Wert.
- Fehlercodes gezielt behandeln:
  - Unique-Verstoß: „Prio X ist bereits vergeben“
  - Bereichsfehler: „Prio muss zwischen 1 und 12 liegen“

3) Sortierung zentral und stabil machen
- In `useRooms` eine zentrale Sortierfunktion verwenden (Priority asc, dann Name asc) und bei `loadRooms` + `updateRoomLocally` anwenden.
- Dadurch sind alle Ansichten konsistent sortiert, nicht nur einzelne Komponenten.

4) UI-Validierung für Doppelvergabe ergänzen
- In `RoomStatusTable` vor dem Speichern lokal prüfen, ob die Ziel-Prio schon von einem anderen Raum belegt ist.
- Bei Konflikt sofort Fehlhinweis anzeigen und Eingabewert zurücksetzen (kein „scheinbar gespeichert“ Zustand).
- Gleiches Verhalten für Raumverwaltung (`RoomManager`) sicherstellen, damit beide Einstellorte identisch arbeiten.

Betroffene Dateien
- `src/hooks/useRooms.ts` (Save-Result, Rollback-Unterstützung, zentrale Sortierung)
- `src/pages/Index.tsx` (async Prioritäts-Handler mit Rollback)
- `src/components/heating/RoomStatusTable.tsx` (Unique-Check + sauberes Input-Reset)
- `src/components/heating/RoomManager.tsx` (gleiche Unique-Validierung beim Bearbeiten)
- neue DB-Migration für Constraint-Änderung + Unique-Constraint; einmalige Datenbereinigung vor Aktivierung der Unique-Regel

Technische Details
- Reihenfolge in DB:
  1) Daten bereinigen (Duplikate entfernen)
  2) `rooms_priority_check` auf `1..12`
  3) `UNIQUE(priority)` hinzufügen
- Fehlerursache war konkret: `new row violates check constraint "rooms_priority_check"` bei `priority=12`.
- Nach Umsetzung gilt: sofortige UI-Neusortierung + persistente Speicherung + harte Eindeutigkeit auf Datenbankebene.
