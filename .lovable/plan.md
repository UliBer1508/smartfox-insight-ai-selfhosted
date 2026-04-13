

## Plan: DB target_temp bei "keep"-Entscheidungen synchronisieren

### Problem
Die UI zeigt falsche Modi an (z.B. "Komfort" statt "Eco"), weil `target_temp` in der DB nur aktualisiert wird wenn ein Tuya API-Call erfolgt. Bei `action === 'keep'` oder `action === 'skip'` wird die DB **nicht** aktualisiert — die alten Werte bleiben stehen.

Beispiele aus der DB jetzt:
- Kinder Bad: `target_temp=20` (zeigt Komfort), aber Automation sagt "Eco halten" → sollte 19 sein
- Flur: `target_temp=20`, sollte Eco (19) sein  
- Haustür: `target_temp=20`, sollte Eco (19) sein

### Ursache
In `pv-automation/index.ts`:
- Zeile 1992-2001: Bei `action === 'keep'` wird nur ein Result gepusht, **kein DB-Update**
- Zeile 2020-2031: Bei `shouldSkip` ebenfalls kein DB-Update
- Die berechnete `targetTemp` geht verloren

### Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

1. **Bei `action === 'keep'` (Zeile 1992-2001)**: Nach dem Result-Push ein DB-Update einfügen, das `target_temp` auf die berechnete `targetTemp` setzt — aber **nur wenn** sich der Wert um mehr als 0.5°C vom DB-Wert unterscheidet (um unnötige Writes zu vermeiden):

```typescript
if (action === 'keep') {
  // DB-Sync: target_temp korrigieren wenn abweichend (ohne Tuya-Call)
  const dbTargetDrift = Math.abs(currentTargetTemp - Number(targetTemp));
  if (dbTargetDrift >= 0.5) {
    await supabase.from('rooms').update({
      target_temp: targetTemp
    }).eq('id', room.id);
    console.log(`[PV-Automation] ${room.name}: DB-Sync target_temp ${currentTargetTemp}→${targetTemp}°C (keep, kein API-Call)`);
  }
  results.push({ ... });
  continue;
}
```

2. **Bei `shouldSkip` (Zeile 2020-2031)**: Gleiche Logik — DB-target_temp korrigieren falls abweichend.

### Auswirkung
- Kein zusätzlicher Tuya API-Call (nur DB-Write)
- UI zeigt sofort den korrekten Modus an
- Kostet keine Quota

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen 1992-2001 und 2020-2031

