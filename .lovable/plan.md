
# Plan: Alle automatisierten Räume in pv-automation einbeziehen

## Problem-Zusammenfassung

### Aktuelle Situation
4 Räume (Bad Uli, Büro, Waschraum, Wirtschaftsraum) haben:
- `pv_auto_enabled: false`
- `automation_enabled: true`

Diese Räume werden **NICHT** von der `pv-automation` geladen und daher:
- Bekommen keinen Nachtmodus (bleiben auf 20°C statt 18°C)
- Werden nicht vom Budget-System pausiert
- Heizen autonom mit Netzstrom

### Beweis
```
Büro       | 20°C | heizt | pv_auto_enabled: false → nicht in Budget-Logik!
Bad Uli    | 20°C | aus   | pv_auto_enabled: false → nicht pausiert!
```

Keine Logs für diese Räume in der pv-automation.

## Die Lösung

### Schritt 1: Query erweitern - Alle automatisierten Räume laden

Zeile 508-511 in `pv-automation/index.ts`:

```typescript
// VORHER:
const { data: rooms, error: roomsError } = await supabase
  .from('rooms')
  .select('*')
  .eq('pv_auto_enabled', true);

// NACHHER:
const { data: rooms, error: roomsError } = await supabase
  .from('rooms')
  .select('*')
  .eq('automation_enabled', true)
  .not('tuya_device_id', 'is', null);
```

### Schritt 2: Unterschiedliche Behandlung je nach pv_auto_enabled

Räume mit `pv_auto_enabled: false` sollten:
- Nachtmodus bekommen (18°C nachts)
- Budget-Pause bekommen (15°C wenn wenig PV)
- NICHT aktiv auf Komfort geheizt werden (nur Eco/Night)

Die bestehende Logik prüft bereits `room.pv_auto_enabled` für PV-Heizen - diese Räume würden also automatisch nur Eco-Temperatur oder Budget-Pause bekommen.

## Dateiänderungen

| Datei | Zeilen | Änderung |
|-------|--------|----------|
| `supabase/functions/pv-automation/index.ts` | 508-511 | Query von `pv_auto_enabled` auf `automation_enabled` ändern |

## Code-Änderung

```typescript
// supabase/functions/pv-automation/index.ts - Zeilen 508-511

// VORHER:
const { data: rooms, error: roomsError } = await supabase
  .from('rooms')
  .select('*')
  .eq('pv_auto_enabled', true);

// NACHHER:
// Alle automatisierten Räume laden - nicht nur die mit PV-Heizen
// Dadurch bekommen auch Räume mit pv_auto_enabled=false:
// - Nachtmodus (night_temp)
// - Budget-Pause (15°C wenn PV niedrig)
// - Aber KEIN aktives PV-Heizen auf Komfort
const { data: rooms, error: roomsError } = await supabase
  .from('rooms')
  .select('*')
  .eq('automation_enabled', true)
  .not('tuya_device_id', 'is', null);
```

## Erwartetes Ergebnis

### Jetzt (PV = 450W, Budget = 0W):
```text
Alle 10 Räume:
  → target_temp: 15°C (Budget-Stopp)
  → is_heating: false
  → Netzbezug: ~360W (nur Grundlast)
```

### Bei PV = 3000W (Budget = 2500W):
```text
Räume mit pv_auto_enabled=true:
  → Können auf Komfort (22°C) heizen, Budget-kontrolliert

Räume mit pv_auto_enabled=false (Büro, Bad Uli, etc.):
  → Bleiben auf Eco (19-20°C), kein aktives PV-Heizen
  → Werden aber trotzdem pausiert wenn Budget erschöpft
```

### Nachts (22:00-08:00):
```text
Alle 10 Räume:
  → target_temp: 18°C (Nachtmodus)
  → Kein Heizen mit Netzstrom mehr!
```

## Risiken und Abwägungen

### Risiko: Mehr Tuya API-Calls
- Jetzt: 6 Räume werden verarbeitet
- Nachher: 10 Räume werden verarbeitet
- Lösung: Die SKIP-Logik verhindert unnötige API-Calls wenn Temperatur bereits korrekt ist

### Alternative: pv_auto_enabled für alle Räume aktivieren
Statt Code-Änderung könnte man auch einfach in der Datenbank setzen:
```sql
UPDATE rooms SET pv_auto_enabled = true WHERE tuya_device_id IS NOT NULL;
```
Aber das würde auch PV-Heizen für diese Räume aktivieren, was möglicherweise nicht gewünscht ist.

## Test-Plan

1. Edge Function deployen
2. pv-automation triggern
3. Logs prüfen: Alle 10 Räume sollten erscheinen
4. Bad Uli, Büro sollten auf 15°C (Budget-Pause) gehen
5. Netzbezug prüfen: Sollte auf ~360W fallen
