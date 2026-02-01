
# Plan: Tuya API-Zugriffe auf Trial-Limits optimieren

## Zusammenfassung
Die Tuya Cloud API wird aktuell viel zu häufig aufgerufen (ca. 95.000 Calls/Monat bei 10 Thermostaten). Das Trial-Edition-Limit liegt bei ca. 500-1000 Calls/Monat. Wir müssen die Zugriffe drastisch reduzieren, bis der lokale Node.js Collector mit Local Keys einsatzbereit ist.

---

## Aktueller API-Verbrauch

| Szenario | Calls pro 5 Min | Pro Tag | Pro Monat |
|----------|-----------------|---------|-----------|
| Aktuell (10 Geräte, 5-Min-Intervall) | 11 | ~3.168 | ~95.000 |
| **Limit Trial Edition** | - | - | ~500-1000 |

### Ursache des hohen Verbrauchs
- `/sync-all` Endpoint ruft für **jedes der 10 Geräte** einzeln die Tuya API auf
- Token wird zwar gecached (2h), aber Geräte-Status-Abfragen nicht
- Automatisierung läuft alle 5 Minuten

---

## Optimierungsplan

### Schritt 1: Sync-Intervall drastisch erhöhen
**Ziel**: Von 5 Minuten auf 15-30 Minuten erhöhen

- In `data_retention_settings` den Wert `polling_interval_seconds` auf 1800 (30 Min) setzen
- Das reduziert Calls auf ~1.584/Monat (noch zu viel!)

### Schritt 2: Batch-API für Geräte-Status nutzen
**Ziel**: Statt 10 einzelner Calls nur 1 Call für alle Geräte

Tuya bietet einen Batch-Status-Endpoint:
```
GET /v1.0/devices/status?device_ids=id1,id2,id3,...
```
Das reduziert 10 Calls auf 1 Call = **90% Einsparung**

### Schritt 3: Intelligente Sync-Logik
**Ziel**: Nur bei Bedarf synchronisieren

- **Nur synchronisieren wenn Automation aktiv** (tagsüber mit PV-Überschuss)
- **Nachts keine Cloud-Calls** (22:00-08:00 = 10h ohne Calls)
- **Bei manueller Änderung sofort** (on-demand statt Polling)

### Schritt 4: Temperatur-Befehle über Command-Queue
**Status**: Bereits implementiert in `useTuyaControl.ts`

Temperatur-Änderungen werden bereits in die `thermostat_commands` Tabelle geschrieben, statt direkt die API aufzurufen. Das funktioniert aber nur wenn der lokale Collector läuft.

---

## Empfohlene Sofort-Maßnahmen

### A) Automatische Syncs deaktivieren (temporär)
Da die Quota wieder aktiv ist, sollten wir:
1. **Sync-Intervall auf 60 Minuten** setzen (1800s → 3600s)
2. **Nachts komplett pausieren** (kein Sync zwischen 22:00-08:00)

**Neuer Verbrauch pro Monat**:
- 16 Stunden/Tag aktiv × 1 Sync/Stunde × 30 Tage = 480 Syncs
- Mit Batch-API: 480 Calls + 480 Token-Checks = **~960 Calls/Monat** ✅

### B) Local Keys abrufen (jetzt!)
Mit der aktiven Quota sollten wir sofort:
1. **Im API Explorer** → `Device Management` → `Query Device Details`
2. Für jede Device ID den `local_key` abrufen
3. In die `rooms` Tabelle speichern (Spalte `local_key`)

---

## Technische Änderungen

### 1. Datenbank: Sync-Intervall erhöhen
```sql
UPDATE data_retention_settings 
SET polling_interval_seconds = 3600; -- 60 Minuten statt 5
```

### 2. Edge Function: Batch-API implementieren
Änderung in `tuya-control/index.ts`:
```typescript
// ALT: 10 einzelne Calls
for (const room of rooms) {
  await getDeviceStatus(accessId, accessSecret, room.tuya_device_id);
}

// NEU: 1 Batch-Call
const deviceIds = rooms.map(r => r.tuya_device_id).join(',');
const allStatus = await tuyaRequest(accessId, accessSecret, 'GET', 
  `/v1.0/devices/status?device_ids=${deviceIds}`);
```

### 3. Edge Function: Nacht-Pause einbauen
In `pv-automation/index.ts`:
```typescript
// Nachts keine Tuya-Calls (lokaler Collector übernimmt)
const { isNight } = isNightTime(settings.night_start_time, settings.night_end_time);
if (isNight && !forceSync) {
  return { message: 'Night mode - no cloud sync' };
}
```

---

## Reihenfolge der Umsetzung

1. ✅ **Erledigt**: Sync-Intervall in DB auf 60 Min erhöht
2. ✅ **Erledigt**: Batch-API in tuya-control implementiert (1 Call statt 10)
3. ✅ **Erledigt**: Nacht-Pause Logik in pv-automation eingebaut
4. 🔲 **Noch offen**: Local Keys im API Explorer abrufen und in rooms-Tabelle speichern
5. 🔲 **Langfristig**: Lokaler Node.js Collector mit Local Keys → 0 Cloud-Calls

---

## Erwartetes Ergebnis

| Optimierung | Calls/Monat |
|-------------|-------------|
| Aktuell | ~95.000 |
| Nach Intervall-Erhöhung (60 Min) | ~8.640 |
| Mit Batch-API | ~1.440 |
| Mit Nacht-Pause | **~960** ✅ |
| Mit lokalem Collector | **0** 🎯 |

Nach Umsetzung bleiben wir deutlich unter dem Trial-Limit von ~1.000 Calls/Monat.
