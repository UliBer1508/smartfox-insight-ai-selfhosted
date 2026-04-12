

# Analyse: Tuya API Quota-Problem und Lösungen

## Ist-Zustand

| Parameter | Wert |
|-----------|------|
| Monatslimit | 900 API-Calls |
| Tageslimit (konfiguriert) | 33 Calls |
| Heute verbraucht | **61 Calls** (fast doppelt über Limit!) |
| Monat verbraucht | 403/900 (Tag 12 von 30) |
| Cron-Intervall | **alle 2 Minuten** = 720 Runs/Tag |

## Hauptverursacher der Quota-Verschwendung

### 1. Pre-Sync frisst das meiste Budget
`pv-automation` ruft alle 30 Minuten `tuya-control/sync-all` auf, um frische Thermostat-Daten zu holen. Das kostet **2 API-Calls** pro Sync (Token + Batch-Status), wird aber im Counter nur als **1 Call** gezählt.

- ~32 Sync-Aufrufe/Tag × 2 = **~64 echte API-Calls** nur für Syncing
- Das ist bereits das **doppelte** Tagesbudget!

### 2. Nachtmodus macht unnötige API-Calls
Nachts (22:00–06:00) setzt das System bei **jedem** Cron-Run die Thermostate auf Frost/Nachttemp — auch wenn sie bereits dort stehen. Der Guard `roomsNeedingOff` prüft zwar, aber bei jedem Neustart des Edge-Function-Containers werden Calls gemacht.

### 3. PV-Priority-Modus umgeht Quota
Bei hohem PV-Überschuss erlaubt das System bis zu **6 Extra-Calls** auch wenn die Quota erschöpft ist. Das erhöht den Counter über das Limit.

### 4. Counter-Inkonsistenz
- Pre-Sync zählt 1 Call, kostet aber 2
- `sync-all` in tuya-control zählt korrekt 2
- Race Condition: `pv-automation`, `tuya-control` und `apply-recommendations` updaten den gleichen Counter unabhängig

## Lösungsplan

### A. Pre-Sync eliminieren oder drastisch reduzieren
**Der lokale Collector** schreibt bereits `current_temp` in die Datenbank. Ein Cloud-Sync ist nur nötig wenn der Collector offline ist. 

**Änderung**: Pre-Sync nur noch alle **2 Stunden** statt 30 Minuten, und nur wenn `last_thermostat_sync` älter als 90 Minuten ist.

→ Ersparnis: **~56 Calls/Tag**

### B. Counter korrekt zählen
Pre-Sync als 2 Calls zählen (nicht 1). So stimmt das interne Tracking mit der Realität überein.

### C. Nacht-Modus: Nur einmal pushen
Nachts wird die Zieltemperatur einmal gesetzt. Danach wird bei jedem Cron-Run geprüft ob `target_temp` bereits korrekt ist → **kein API-Call**. Das funktioniert bereits teilweise (Zeile 581-586), aber der Check muss strenger werden.

### D. PV-Priority-Limit senken
Von 6 auf **3 Calls** reduzieren. Und PV-Priority nur ab gridExport > 1500W (statt 500W), damit der Modus nicht zu leicht aktiviert wird.

### E. Stale-Sync-Guard lockern
Der `syncStale`-Check (>30 min) erzwingt API-Calls auch wenn sich nichts geändert hat. Auf **60 Minuten** erhöhen.

### F. Dynamisches Cron-Skipping
Wenn `quotaExhausted = true` und kein PV-Priority-Modus: Die pv-automation-Funktion kehrt sofort zurück **ohne** die Quota-Daten neu zu schreiben (vermeidet unnötige DB-Writes).

## Erwartete Verbesserung

```text
Aktuell:
  Pre-Sync: ~64 Calls/Tag
  Nacht-Pushes: ~10-20 Calls
  Tages-Automation: ~20-30 Calls
  GESAMT: ~100+ Calls/Tag (Limit: 33!)

Nach Fix:
  Pre-Sync: ~8 Calls/Tag (alle 2h, 8h Tageslicht)
  Nacht-Pushes: ~2-4 Calls (einmal pro Raum, nur wenn nötig)
  Tages-Automation: ~15-20 Calls (skip-logic greift besser)
  GESAMT: ~25-30 Calls/Tag ✅
```

## Betroffene Dateien
- `supabase/functions/pv-automation/index.ts` — Pre-Sync-Intervall, Counter-Fix, PV-Priority-Limit, Stale-Sync-Guard

