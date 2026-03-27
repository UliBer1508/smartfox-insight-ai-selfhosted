

# Analyse: Warum wird die Tuya-Quota trotzdem überschritten?

## Ursache: Zwei kritische Bugs

### Bug 1: `setTemperatureForMode()` ignoriert `quotaExhausted`
Die Funktion (Zeile 462-491) prüft **nicht** ob die Quota erschöpft ist. Wenn `controlMode === 'cloud'`, wird **immer** `setDeviceTemperature()` aufgerufen — auch wenn `quotaExhausted = true`. Die Quota-Variable wird zwar gesetzt, aber nirgends als Gate vor den API-Calls verwendet.

### Bug 2: FORCE-SYNC feuert massiv bei Low-PV
Die Logik ab Zeile 1611-1624:
- `syncStale` = letzter Sync > 10 Minuten alt
- Bei `pvPower < 500W` → **jeder** Raum wird von `keep` auf `deactivate` umgeschrieben
- Das umgeht die Skip-Logik (Zeile 1670: `!syncStale` = false)
- **12 Räume × alle 10 Min = ~72 API-Calls pro Stunde** bei Low-PV

### Rechenbeispiel heute:
- Automation läuft alle 2 Minuten = 30×/Stunde
- Bei jedem Run: ~3-4 Räume werden FORCE-SYNC'd (je nach Timing)
- Pre-Sync: 2 Calls alle 15 Min = ~8/Tag
- **Ergebnis: 33er Tageslimit ist in < 1 Stunde aufgebraucht**

## Lösung

### Änderung 1: Quota-Gate in `setTemperatureForMode()`
Wenn `quotaExhausted === true` und `controlMode === 'cloud'`:
- Sofort `{ success: false, errorType: 'quota_exhausted' }` zurückgeben
- **Kein** API-Call ausführen
- DB-Updates (is_heating, target_temp) trotzdem machen für Dashboard-Konsistenz

### Änderung 2: FORCE-SYNC Frequenz drastisch reduzieren
- `syncStale` Schwelle von 10 Min auf **30 Min** erhöhen
- FORCE-SYNC nur wenn `!quotaExhausted` — bei erschöpfter Quota soll nicht force-synced werden
- Maximal 1 FORCE-SYNC pro Run (nicht alle 12 Räume gleichzeitig)

### Änderung 3: Pre-Sync bei Quota-Erschöpfung überspringen
- Zeile 696: Zusätzliche Bedingung `&& !quotaExhausted` beim `shouldSync`-Check

### Änderung 4: Dashboard-Warnung
- `ApiErrorBanner` erweitern: Bei `quota_exhausted` Fehlertyp prominente Warnung anzeigen mit Hinweis "Thermostate manuell auf Frostschutz stellen"

### Betroffene Dateien
1. `supabase/functions/pv-automation/index.ts` — Quota-Gate, FORCE-SYNC Limits, Pre-Sync Skip
2. `src/components/heating/ApiErrorBanner.tsx` — Quota-Warnung im Dashboard

