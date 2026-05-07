# Plan: ML/KI tiefer in pv-automation integrieren

Drei aufeinander abgestimmte Verbesserungen, die ML-Outputs aktiv in die Heizungssteuerung einbringen und sichtbar machen.

---

## 1. `learning_confidence` aktiv nutzen in `pv-automation`

**Datei:** `supabase/functions/pv-automation/index.ts` (Zeile ~2842–2876)

Aktuelle Schwelle für Exploitation: `sample_count >= 20 && success_rate > 0.5`. Neue dreistufige Logik basierend auf `learning_confidence`:

```text
learning_confidence >= 0.7  → Exploitation (Policy folgen)
learning_confidence 0.4-0.7 → Soft-Hint: Policy nur folgen wenn sie mit Budget-
                              Logik kompatibel ist (kein activate gegen leeres
                              Budget, kein deactivate eines Komfort-gesättigten
                              Raums); sonst Standard-Pfad
learning_confidence < 0.4   → Policy ignorieren, immer LLM/Standard
```

Zusätzlich `learnedPolicy.recommended_temp` nur übernehmen wenn innerhalb `[night_temp, comfort_temp]` des Raums (Safety-Clamp).

Reasoning-Text erweitern: `📊 Policy (conf 0.82, 12 Samples, ...)` damit im UI sichtbar warum die Policy gewählt/ignoriert wurde.

**Tracking:** Pro Entscheidung in das bereits bestehende `learning_events.action`-Objekt zwei Felder schreiben:
- `ml_recommendation`: `{ action, temp, confidence }` (immer was die Policy gesagt hätte)
- `ml_followed`: `boolean` (ob pv-automation der Empfehlung gefolgt ist)

---

## 2. `preheatingAdvice` strukturell als Pre-Heat-Trigger nutzen

**Problem heute:** `analyze-patterns` berechnet `preheatingAdvice` (z.B. "Peak in 60 min, jetzt vorheizen"), schreibt es aber nur in den LLM-Prompt. `pv-automation` sieht es nicht.

**Lösung:** Strukturierte Speicherung + Konsum:

**a) `analyze-patterns/index.ts`** (Zeile ~336):
Nach Berechnung von `preheatingAdvice` zusätzlich strukturiertes Objekt in `system_settings` upserten:
```ts
await supabase.from('system_settings').upsert({
  key: 'preheating_signal',
  value: {
    computed_at: now.toISOString(),
    type: 'preheat' | 'store_heat' | 'none',
    target_peak_hour: nextPeakHour?.hour,
    minutes_to_peak: minutesToPeak,
    expected_peak_w: nextPeakHour?.watts,
    advice_text: preheatingAdvice,
  }
}, { onConflict: 'key' });
```

**b) `pv-automation/index.ts`** (vor Raum-Loop, ca. Zeile 2620 nach learnedPolicies-Block):
Signal lesen, nur valide wenn `computed_at` jünger als 30 min:

```ts
const { data: preheatRow } = await supabase
  .from('system_settings').select('value')
  .eq('key', 'preheating_signal').maybeSingle();
const preheatSignal = (preheatRow?.value && 
  Date.now() - new Date(preheatRow.value.computed_at).getTime() < 30*60*1000)
  ? preheatRow.value : null;
```

**Wirkung im Raum-Loop:**
- `type === 'preheat'` (Peak in ≤90 min, aktuell wenig PV): Eco-Budget-Schwelle für Phase 1 wird **temporär abgesenkt** — Räume mit `current < eco - 0.2` dürfen bereits jetzt aus der Batterie heizen, auch wenn `effectiveExport` sonst zu klein wäre. Hard-Locks (SOC < heating_min_battery_soc, harter PV-Gate ohne Tagesprognose) bleiben unverändert.
- `type === 'store_heat'` (Peak endet in ≤60 min, aktuell viel PV): Phase 2 (Komfort) wird **bevorzugt** für Räume mit hoher `floor_area_m2` ausgeführt → Estrich-Speicherung. Setzt einen Bonus auf `comfortBudget` (z.B. +500W) wenn `pvPower > 4000`.
- Reasoning-Text: `🔥 Pre-Heat aktiv (Peak in 60min)` bzw. `💾 Store-Heat (Peak endet bald)`.

Sicherheits-Constraints:
- Pre-Heat darf **nicht** Komfort-Hard-Lock bei niedrigem SOC umgehen.
- Pre-Heat darf **nicht** Manual-Override ignorieren.
- Wenn `quotaExhausted` → Signal wird gelesen aber kein zusätzlicher Tuya-Call ausgelöst.

---

## 3. ML-Follow-Rate Dashboard-Widget

**a) Neue RPC** (Migration): `get_ml_follow_rate(days_back int)` aggregiert aus `learning_events`:
```sql
SELECT
  date_trunc('day', timestamp AT TIME ZONE 'Europe/Vienna')::date as day,
  COUNT(*) FILTER (WHERE action ? 'ml_recommendation') as total_with_ml,
  COUNT(*) FILTER (WHERE (action->>'ml_followed')::bool = true) as followed,
  COUNT(*) FILTER (WHERE (action->>'ml_followed')::bool = false) as overridden,
  AVG(reward) FILTER (WHERE (action->>'ml_followed')::bool = true) as reward_when_followed,
  AVG(reward) FILTER (WHERE (action->>'ml_followed')::bool = false) as reward_when_overridden
FROM learning_events
WHERE timestamp >= now() - (days_back || ' days')::interval
  AND action ? 'ml_recommendation'
GROUP BY 1 ORDER BY 1 DESC;
```

**b) Neue Komponente** `src/components/heating/MLFollowRateWidget.tsx`:
- Zeigt für letzte 7 Tage:
  - Follow-Rate in % (followed / total_with_ml) als großen KPI
  - Avg Reward wenn ML gefolgt vs. überstimmt (Vergleich)
  - Mini-Bar-Chart pro Tag (folgte/überstimmte Anzahl)
- Lädt via `supabase.rpc('get_ml_follow_rate', { days_back: 7 })`
- Refresh alle 5 Minuten

**c) Einbindung:** In `HeatingDashboard.tsx` neben dem bestehenden `AIStatusWidget` platzieren (oder darunter, je nach Layout-Slot).

---

## Reihenfolge

1. Migration: RPC `get_ml_follow_rate` anlegen.
2. `pv-automation`: Konfidenz-Gating + Pre-Heat-Konsum + ml_recommendation/ml_followed-Tracking.
3. `analyze-patterns`: `preheating_signal` in `system_settings` upserten.
4. UI: `MLFollowRateWidget.tsx` + Einbindung im Dashboard.
5. Memory-Update: `mem://arch/ai-system-limitations` ergänzen um Konfidenz-Stufen + Pre-Heat-Mechanik.

## Out of Scope
- Keine Änderung der Reward-Funktion (gerade erst normalisiert).
- Keine Änderung am LLM-Exploration-Throttle.
- Keine Migration bestehender `learning_events` (neue Felder nur ab jetzt).
