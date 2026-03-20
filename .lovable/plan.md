

# Priorität sofort sortieren und speichern

## Problem

Die Prioritätsänderung nutzt `onBlur` — der Wert wird erst beim Verlassen des Feldes gespeichert. Die Sortierung aktualisiert sich erst nach dem DB-Reload. Außerdem nutzt `saveRoom` ohne `skipReload` ein volles Reload, was langsam ist.

## Lösung

1. **`onBlur` beibehalten** für das Speichern, aber sofort ein **optimistisches lokales Update** durchführen mit `updateRoomLocally`
2. Dann im Hintergrund in die DB speichern mit `skipReload = true`
3. Die lokale State-Änderung triggert sofort die Neu-Sortierung (da `tuyaRooms` bei jedem Render sortiert wird)

## Änderung

**Datei:** `src/pages/Index.tsx` (Zeile 209)

Die `onSavePriority` Callback ändern: Zuerst `updateRoomLocally` aufrufen für sofortige UI-Sortierung, dann `saveRoom` mit `skipReload=true`:

```typescript
onSavePriority={(roomId, priority) => {
  updateRoomLocally(roomId, { priority });
  saveRoom({ id: roomId, priority }, true);
}}
```

`updateRoomLocally` und `saveRoom` kommen beide aus `useRooms()` und sind bereits verfügbar in Index.tsx.

