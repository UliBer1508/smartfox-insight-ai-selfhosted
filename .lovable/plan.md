

# Fix: Warmwasser-Check komplett entfernen

## Warum

Der Smartfox steuert das Warmwasser eigenständig basierend auf PV-Überschuss. Das pv-automation System hat keinen Einfluss darauf. Der `gridExport` ist bereits der Netto-Überschuss **nach** Warmwasser und allen anderen Verbrauchern. Ein zusätzlicher Warmwasser-Check zählt die Last doppelt und blockiert Räume fälschlich.

## Änderung

**Datei:** `supabase/functions/pv-automation/index.ts`

### Stufe 2 (Zeilen 1354-1366) vereinfachen

Vorher (mit unnötigem WW-Check):
```typescript
} else if (...&& exportCoversRoom && batteryFull) {
  const exportCoversRoomAndHW = !hotwaterActive || gridExport >= roomHeatingPower + hotwaterPower;
  if (exportCoversRoomAndHW) { ... } else { ... }
}
```

Nachher (direkt heizen wenn Budget OK):
```typescript
} else if (currentRoomTemp < comfortTemp - 0.3 && exportCoversRoom && batteryFull) {
  action = 'activate';
  targetTemp = comfortTemp;
  reasoning = `☀️ Stufe 2: Komfort ${comfortTemp}°C (Batterie ${batterySoc}%, Budget OK)`;
}
```

### Stufe 3 (Zeilen 1367-1387) vereinfachen

Gleicher Fix: `exportCoversRoomAndHW`-Check und die if/else-Verzweigung entfernen. Direkt auf Budget und Batterie-Status vertrauen:
```typescript
} else if (allRoomsAtComfort && exportCoversRoom && batteryFull && currentRoomTemp >= comfortTemp - 0.3) {
  const highestPriorityRoom = roomsWithPriority[0];
  if (highestPriorityRoom && highestPriorityRoom.room.id === room.id) {
    action = 'activate';
    targetTemp = comfortTemp + 1;
    reasoning = `🔥 Stufe 3: Super-Komfort ${comfortTemp + 1}°C (alle ≥ comfort, Budget OK)`;
  } else {
    action = 'keep';
    targetTemp = comfortTemp;
    reasoning = `✅ Komfort erreicht, Super-Komfort nur für Prio-Raum`;
  }
}
```

## Ergebnis

- Kein doppeltes Abrechnen von Warmwasser
- Budget-System hat volle Kontrolle
- Räume werden bei ausreichend Export sofort auf Komfort geheizt

