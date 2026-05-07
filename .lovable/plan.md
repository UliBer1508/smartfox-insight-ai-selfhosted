## Plan: 5 KI/ML-Verbesserungen

Alle 5 Verbesserungen wie spezifiziert umsetzen — rein serverseitig in Edge Functions + 1 Migration.

### 1. `supabase/functions/evaluate-decision/index.ts`
- `calculateReward` komplett ersetzen durch normalisierte Variante (alle Komponenten in [-1,+1], gewichtete Summe mit `weights`-Objekt: energy_cost 0.35, pv_usage 0.30, comfort 0.25, battery 0.05, forecast 0.05).
- `breakdown._weights` mitspeichern für Transparenz.
- Hinweis: bestehende Breakdown-Keys (`energy_cost`, `comfort_bonus`, `pv_usage_bonus`, `battery_efficiency`, `efficiency_bonus`, `forecast_quality`) ändern sich zu `energy_cost`, `pv_usage`, `comfort`, `battery`, `forecast`. `efficiency_bonus` entfällt — kein Konsument im Code (verifiziert in `update-learned-policies` und Frontend).

### 2. `supabase/functions/ml-feature-extraction/index.ts`
- Konfidenz-Block (Zeilen 151–196) ersetzen: neue 3-Faktor-Berechnung
  - cycleScore (40%): basierend auf `heatingCycles` (sigmoid-artig)
  - consistencyScore (30%): Variationskoeffizient der Heizraten aus `tempSamples`
  - recencyScore (30%): Tage seit letztem Sample
- `confidence = round((cycle*0.4 + consistency*0.3 + recency*0.3) * 100)/100`
- `sample_count` und Return-Objekt unverändert.

### 3. `supabase/functions/update-learned-policies/index.ts`
- Hilfsfunktion `getViennaHour(date)` via `Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: 'numeric', hour12: false })` direkt nach den Imports einfügen.
- Im Event-Loop die grobe DST-Näherung (`month >= 2 && month <= 9 ? 2 : 1`) durch `const viennaHour = getViennaHour(eventDate);` ersetzen.

### 4. `supabase/functions/update-learned-policies/index.ts` (Verbesserung 5)
- Schwelle `if (data.rewards.length < 3) continue;` → `if (data.rewards.length < 1) continue;`
- `sampleConfidence = Math.min(0.95, 1 - Math.exp(-data.rewards.length * 0.3))`
- Im Upsert: `avg_reward: round(bestAvgReward * sampleConfidence * 1000)/1000`, neues Feld `learning_confidence: round(sampleConfidence * 1000)/1000`.

### 5. Migration `supabase/migrations/<timestamp>_add_learning_confidence.sql`
```sql
ALTER TABLE learned_policies
  ADD COLUMN IF NOT EXISTS learning_confidence float DEFAULT 0;
COMMENT ON COLUMN learned_policies.learning_confidence IS
  'Konfidenz basierend auf Anzahl Samples: 1=0.26, 3=0.59, 10+=0.95';
```

### 6. `supabase/functions/analyze-patterns/index.ts` (Verbesserung 4)
- Nach `peakHours`-Berechnung (≈ Zeile 305) den `preheatingAdvice`-Block einfügen (Vorausschau auf nächsten Peak / Peak-Ende, Wiener Zeit via `Intl`).
- Im `optimize_decision`-Prompt direkt nach dem `**ENERGIESITUATION:**`-Block (nach Zeile 323) einfügen:
  `${preheatingAdvice ? '\n**' + preheatingAdvice + '**\n' : ''}`

### Keine Änderungen
- Keine Frontend-Anpassungen.
- Keine Anpassungen an `learned_policies`-Konsumenten in `pv-automation` nötig (lesen `recommended_action`/`recommended_temp`, nicht `avg_reward`).

### Reihenfolge der Ausführung
1. Migration erstellen (DB-Schema zuerst).
2. Edge-Function-Dateien editieren.
3. Auto-Deploy erfolgt durch die Plattform.
