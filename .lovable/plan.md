## Bewertung & Lösung (4 Punkte)

### 1. Funktion ist zu groß (~3500 Zeilen)
Berechtigte Beobachtung, aber **kein Quick-Fix**: Das Aufteilen in `calculate-budget`, `execute-heating-decisions`, `night-handler` würde >1000 geteilte Variablen über HTTP-Calls serialisieren — hohes Regressionsrisiko, mehr Latenz, Quota-Mehrkosten. **Empfehlung: nicht jetzt umsetzen**, sondern als eigener Refactor-Sprint mit Tests planen. Ich lege dafür kein Code an.

### 2. ML-Cache: SOC-Schwelle auf absolute Werte (Zeile ~2440)
Heute: relativ (`socChange = |Δ| / cachedSoc > SIGNIFICANT_CHANGE_THRESHOLD`) → bei normaler Tagesschwankung 80→48% wird invalidiert.
**Fix:** SOC-Invalidierung nur bei den Schwellen, die wirklich Verhalten ändern:
- SOC fällt unter `heatingMinSoc` (Komfort-Hardlock greift) ODER
- SOC steigt erstmals über 90% (Battery-Full-Bonus wird relevant) ODER
- SOC-Bucket-Wechsel ≥15 absolute %-Punkte (Robustheit)

PV-Logik (`pvDroppedBelowGate` 500W) bleibt unverändert.

### 3. Konsistente Batterie-Benennung (Zeile ~1338)
Heute zwei Varianten im Code. **Fix:** Zwei abgeleitete Helper-Konstanten direkt nach der Normalisierung einführen:
```ts
const batteryChargingW   = Math.max(0,  batteryPower); // >0 = lädt
const batteryDischargingW = Math.max(0, -batteryPower); // >0 = entlädt
```
Diese **zusätzlich** zu `batteryPower` bereitstellen. Alle vorhandenen Vorzeichen-Vergleiche bleiben funktional unverändert, neue Codestellen können die klaren Namen verwenden. Dadurch kein Big-Bang-Rewrite, aber sauberer Migrationspfad.

### 4. Learning-Events nur bei echten Aktionen (Zeile ~3217)
Heute: bei jedem Run pro Raum ein Event (12×30/h = 8640/Tag). **Fix:** Insert nur wenn:
- `action === 'activate'` ODER `action === 'deactivate'` ODER
- `usedMlDecision === true` (ML-Entscheidung muss bewertet werden — auch bei `keep`, sonst kein Reward-Feedback)

`keep`/`skip` ohne ML werden nicht mehr persistiert. Spart ~80% der Events ohne Reward-Information zu verlieren. Bestehende Daten unberührt; Cleanup via `cleanup_old_data` (>30d) regelt Volumen.

## Datei-Änderungen
Nur `supabase/functions/pv-automation/index.ts`:
1. ML-Cache-Block (~2440–2457): Ersatz der `socChange`-Bedingung durch absolute Trigger.
2. Nach Zeile 1341: Helper-Konstanten `batteryChargingW`, `batteryDischargingW` einführen.
3. Learning-Event-Insert (~3217): in `if`-Block einwickeln.

Keine DB-Migration, keine Schema-Änderung.
