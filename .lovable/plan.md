

# Problem: Thermostate heizen trotz `target_temp=18°C` in der DB

## Diagnose

Die `pv-automation` läuft jetzt korrekt und setzt `target_temp=18°C` + `heating_paused_reason=budget` in der Datenbank. **Aber die physischen Thermostate haben diesen Befehl nie erhalten.**

Beweis: `last_thermostat_sync` steht bei **allen 12 Räumen** auf `11:14 Uhr` — über 6 Stunden alt. Seitdem wurde kein einziger Tuya-API-Befehl gesendet.

## Ursache: SKIP-Logik nach Crash

Die SKIP-Logik (Zeile 1146-1169) vergleicht:
- `currentTargetTemp` = DB-Wert (`room.target_temp`) = **18°C**
- `newTargetTemp` = berechneter Wert = **18°C**
- Ergebnis: `tempAlreadyCorrect = true` → **SKIP**

Das Problem: Während des Auth-Crashs (401-Phase) wurde `target_temp` in der DB auf 18°C gesetzt, **ohne** dass der Tuya-API-Call durchging. Jetzt denkt die Funktion "ist bereits korrekt" und überspringt den API-Call. Der physische Thermostat steht aber noch auf 20°C und heizt weiter.

## Lösung: Stale-Sync-Check in SKIP-Logik

Die SKIP-Logik muss `last_thermostat_sync` prüfen. Wenn der letzte erfolgreiche Sync zu alt ist (>10 Minuten), wird **immer** ein Force-Push gemacht, unabhängig davon ob die DB-Temperatur "korrekt" aussieht.

### Änderungen

**Datei: `supabase/functions/pv-automation/index.ts`**

1. **Room-Query erweitern** (~Zeile 830): `last_thermostat_sync` mit laden (falls nicht schon vorhanden).

2. **SKIP-Logik erweitern** (Zeile 1146-1169): Neue Bedingung einfügen:
```typescript
// Force-push wenn letzter Sync zu alt (>10 Min) - verhindert Desync nach Crash/Restart
const lastSync = room.last_thermostat_sync ? new Date(room.last_thermostat_sync).getTime() : 0;
const syncAge = Date.now() - lastSync;
const syncStale = syncAge > 10 * 60 * 1000; // >10 Minuten

const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp && !syncStale;

if (syncStale && tempAlreadyCorrect) {
  console.log(`[PV-Automation] ${room.name}: FORCE-SYNC - last sync ${Math.round(syncAge/60000)} min ago`);
}
```

3. **`last_thermostat_sync` nach erfolgreichem API-Call aktualisieren** — prüfen ob dies bereits passiert (scheint nur in `tuya-control` zu geschehen, nicht in `pv-automation` nach `setTemperatureForMode`).

### Ergebnis
- Beim nächsten Cron-Lauf (in ≤2 Min) erkennt die Funktion den stale Sync und pusht 18°C an alle Thermostate
- Die 6kW Netzbezug sinken auf 0W sobald die Thermostate den Befehl erhalten
- Zukünftige Crash-Recovery ist automatisch abgesichert

