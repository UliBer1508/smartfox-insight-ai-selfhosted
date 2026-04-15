

## Problem: DB-Thermostat-Sync-Lücke im Nachtmodus

### Was passiert

1. **DB sagt** target_temp=5°C für 11/12 Räume
2. **Physische Thermostate** stehen auf ~20°C
3. **Automation** prüft nur DB (`target_temp > 6`), findet keine Räume die geändert werden müssen, und **sendet keine Befehle**

Die TGP508-Thermostate haben **interne Zeitprogramme** (4 Perioden). Wenn das Gerät z.B. "Periode 2: 07:00 → 20°C" gespeichert hat, überschreibt es das Remote-gesetzte 5°C automatisch. Die DB bleibt bei 5°C stehen, aber das Gerät heizt auf 20°C.

### Lösung: Nacht-Resync mit `current_temp`-Prüfung

**Datei: `supabase/functions/pv-automation/index.ts`**

Die Nacht-Frost-Logik muss erweitert werden:

1. **Nicht nur `target_temp` prüfen**, sondern auch `current_temp` — wenn die aktuelle Temperatur steigt obwohl target=5°C sein sollte, stimmt etwas nicht
2. **Periodischen Resync erzwingen**: Alle 30 Minuten nachts trotzdem 5°C senden (statt nur einmal), um interne Thermostat-Programme zu überschreiben
3. **DB-Reset bei Quota-Fehler**: Wenn der Tuya-API-Call fehlschlägt, die DB-`target_temp` **nicht** auf 5°C belassen, sondern auf den tatsächlichen Wert zurücksetzen (z.B. `current_temp` oder letzten bekannten Wert), damit die Automation den Raum beim nächsten Zyklus erneut versucht

Konkrete Änderung in Zeilen 581-597:

```typescript
// NICHT nur DB-target prüfen, sondern ALLE Räume periodisch resyncen
const now = new Date();
const roomsNeedingOff = allRooms.filter(r => {
  const currentTarget = Number(r.target_temp) || 0;
  const lastSync = r.last_thermostat_sync ? new Date(r.last_thermostat_sync) : null;
  const minutesSinceSync = lastSync 
    ? (now.getTime() - lastSync.getTime()) / 60000 
    : Infinity;
  
  // Resync wenn: target nicht auf Frost ODER letzter Sync > 30min her
  return currentTarget > FROST_TEMP + 1 || minutesSinceSync > 30;
});
```

4. **Quota-Schutz beibehalten**: Die Resync-Logik respektiert weiterhin das Quota-System — bei erschöpfter Quota wird geloggt aber kein Call gemacht

### Auswirkung
- Thermostate werden alle 30min erneut auf 5°C gesetzt → interne Programme können nicht überschreiben
- Bei Quota-Erschöpfung: DB wird korrigiert, damit der Fehler sichtbar bleibt
- Tagsüber keine Änderung — betrifft nur den Nachtmodus

