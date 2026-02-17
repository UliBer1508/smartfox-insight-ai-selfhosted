
# Problem 1: Kritische Lernprozess-Bugs beheben

## Identifizierte Bugs

### Bug 1: `wienHour` Referenz-Fehler in `pv-automation/index.ts` (Zeile 881)
**Problem:** 
- Zeile 881 versucht, `wienHour` zu verwenden: `.eq('hour_of_day', wienHour)`
- `wienHour` ist nur innerhalb der `isNightTime()` Funktion (Zeile 48) definiert und dort zurückgegeben
- An der Stelle, wo es verwendet wird (Zeile 881), ist die Variable nicht im Scope – das verursacht einen `ReferenceError`
- Die Auswirkung: Der "Exploitation" Code kann nie ausgeführt werden, da er bei jedem Aufruf crasht

**Lösung:**
- Zeile 874-876: Im Kommentar „LEARNED POLICIES LADEN" ist eine Schleife über Räume
- Dort where also `wienHour` definiert werden soll – wahrscheinlich wurde es vergessen, da `isNightTime()` bereits weiter oben (Zeile 948) aufgerufen wird
- Hole den `wienHour` Wert aus dem `isNightTime()` Call auf Zeile 948 und verwende ihn in Zeile 881
- Das verlangt aber Umstrukturierung: Die `isNightTime()` Berechnung muss **vor** der Policy-Loading Sektion (Zeile 874) erfolgen

### Bug 2: Falsche `decision_type` zu `recommended_action` Mapping in `update-learned-policies/index.ts` (Zeilen 143-147)
**Problem:**
- Die Aggregationslogik versucht, `decision_type` in `recommended_action` abzubilden
- Aber das Mapping ist unvollständig: 95%+ der `decision_type` Werte fallen in die Kategorie `else`, die zu `'keep'` mapped werden
- Beispiele: `'solar_limit_start'`, `'pv_surplus'`, `'grid_powered'`, etc. → alle zu `'keep'` gemappt
- Ergebnis: 240+ Policies haben `recommended_action = 'keep'`, was nutzlos ist (sagt nur "alles beim Alten lassen")
- Die wahren Empfehlungen (`'activate'`, `'deactivate'`) sind unterrepräsentiert

**Lösung:**
- Das Mapping muss alle `decision_type` Werte beachten (nicht nur `'night'`, `'pv'`, `'budget'`)
- Neue Logik:
  - `'solar_limit_start'`, `'pv_surplus'` → `'activate'` (PV-Überschuss nutzen)
  - `'solar_limit_stop'`, `'pv_limit_reached'` → `'deactivate'` (Heizung pausieren)
  - `'grid_powered'` → `'activate'` (kann auch mit Netz heizen)
  - `'night'`, `'night_cycling'` → `'deactivate'` (nachts pausieren)
  - Default → `'keep'` (wenn Decision-Type nicht klar klassifizierbar)

### Bug 3: Fehlender Cron-Job für `ml-feature-extraction`
**Problem:**
- `ml-feature-extraction` wird nie automatisch aufgerufen
- Die Raummerkmale in `room_ml_features` sind 4+ Tage alt
- `pv-automation` nutzt stale Features für Vorhersagen → schlechte Entscheidungen

**Lösung:**
- Erstelle einen Cron-Job für `ml-feature-extraction`
- Trigger täglich um **18:00 UTC** (vor `update-learned-policies` um 19:30 UTC)
- So: Features → Policies → nächster PV-Automation-Run nutzt frische Daten
- SQL Migration analog zu `update-learned-policies` Cron-Job

## Implementierungsplan

### Schritt 1: Fix `wienHour` Bug in `pv-automation/index.ts`
**Datei:** `supabase/functions/pv-automation/index.ts`

**Ansatz:**
1. Verschiebe die `isNightTime()` Berechnung (aktuell Zeile 948) **nach oben** (vor Zeile 874)
2. Speichere den Rückgabewert in einer Variable: `const { isNight, wienTime, wienHour } = isNightTime(...)`
3. Nutze `wienHour` überall in der `LEARNED POLICIES LADEN` Sektion (Zeile 881)
4. Der ursprüngliche Call auf Zeile 948 kann die Variable dann direkterwiederverwenden (kein doppelter Call nötig)

**Code-Änderungen:**
```typescript
// VOR Zeile 874: isNightTime() aufrufen
const nightStart = settings?.night_start_time || '22:00';
const nightEnd = settings?.night_end_time || '08:00';
const { isNight, wienTime, wienHour } = isNightTime(nightStart, nightEnd);

// Zeile 874-881: "LEARNED POLICIES LADEN" nutzt jetzt wienHour
// Zeile 948: Wiederverwendung von wienHour (kein neuer Call nötig, nur `const { isNight, wienTime, wienHour } = ...` bereits oben)
```

### Schritt 2: Fix `decision_type` zu `recommended_action` Mapping in `update-learned-policies/index.ts`
**Datei:** `supabase/functions/update-learned-policies/index.ts` (Zeilen 143-147)

**Neue Mapping-Logik:**
```typescript
// Determine action type from key AND decision_type
const actionParts = bestAction.split('_');
const decisionType = actionParts[0]; // e.g. 'night', 'pv', 'solar_limit', etc.

const recommendedAction = 
  decisionType === 'night' ? 'deactivate'
  : decisionType === 'solar_limit' ? 'deactivate'
  : decisionType === 'pv' ? 'activate'
  : decisionType === 'grid' ? 'activate'
  : decisionType === 'budget' ? 'activate'
  : decisionType === 'solar_heating' ? 'activate'
  : 'keep';
```

### Schritt 3: Cron-Job für `ml-feature-extraction` hinzufügen
**Datei:** Neue SQL Migration

**Timing:**
- Trigger: täglich um **18:00 UTC** (=19:00/20:00 Wien)
- 90 Minuten VOR `update-learned-policies` (19:30 UTC)
- Damit: Neue Features verfügbar, wenn Policies aktualisiert werden

**SQL:**
```sql
SELECT cron.schedule(
  'ml-feature-extraction-daily',
  '0 18 * * *',  -- Every day at 18:00 UTC
  $$
    SELECT net.http_post(
      url := 'https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/ml-feature-extraction',
      headers := '{"Authorization": "Bearer ...", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

## Erwartete Auswirkungen

Nach diesen Fixes:
1. ✅ **Exploitation funktioniert**: `pv-automation` kann jetzt Learned Policies laden (kein ReferenceError mehr)
2. ✅ **Aussagekräftige Policies**: Statt 240× `'keep'` haben wir ausgewogene Mix von `'activate'`, `'deactivate'`, `'keep'`
3. ✅ **Aktuelle Features**: `room_ml_features` werden täglich aktualisiert, nicht 4+ Tage alt
4. ✅ **Self-Learning Cycle komplett**: Features (18:00) → Policies (19:30) → nächster Automation-Run nutzt beides

## Dateien zu ändern
1. `supabase/functions/pv-automation/index.ts` – `wienHour` Bug (2-3 Zeilen ändern)
2. `supabase/functions/update-learned-policies/index.ts` – Mapping-Logik (5 Zeilen ändern)
3. SQL Migration – Cron-Job für `ml-feature-extraction` (neue Datei)

## Risiken & Mitigation
- **Risiko**: Der Code nach Zeile 948 erwartet vielleicht lokale Variablen, die durch die Verschiebung ungültig werden
- **Mitigation**: Wurde überpriift – `isNightTime()` ist eine pure Funktion, hat keine Nebenwirkungen
- **Warnung**: Das `settings` Objekt muss VOR Zeile 874 definiert sein (es ist wahrscheinlich bereits oben vorhanden)
