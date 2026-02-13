

# 3 ML-Probleme lösen

## Problem 1: 88.313 alte Events mit biased Reward

Die alte Reward-Funktion ist deployed, aber alle historischen Events haben noch den falschen Reward (avg -0.839).

**Lösung:** SQL-Reset aller Events auf `is_evaluated = false`, dann `evaluate-decision` mit `evaluate_all: true` aufrufen (in Batches von 50, daher mehrfach).

**Schritte:**
- SQL ausführen: `UPDATE learning_events SET is_evaluated = false, reward = null, reward_breakdown = null, evaluated_at = null`
- `evaluate-decision` Edge Function mehrfach mit `{ "evaluate_all": true }` aufrufen bis alle Events verarbeitet sind
- Ergebnis prüfen: Durchschnitts-Reward sollte für deactivate deutlich besser sein

---

## Problem 2: Alle 240 Policies zeigen 'keep'

Die `update-learned-policies` Funktion wurde mit dem neuen Action-Mapping deployed, aber noch nie ausgeführt.

**Lösung:** Nach der Re-Evaluation (Problem 1) die Funktion manuell aufrufen.

**Schritte:**
- `update-learned-policies` Edge Function aufrufen
- Ergebnis prüfen: Policies sollten jetzt activate/deactivate/keep verteilt sein

---

## Problem 3: Wochenvergleich sagt "nicht genügend Daten"

**Ursache:** Die `daily_patterns` Tabelle ist komplett leer (0 Zeilen). Das `aggregate-energy-data` Script erstellt daily_patterns erst, wenn hourly_aggregates älter als 90 Tage sind -- und die gibt es auch nicht (0 Zeilen). Die Funktion wurde nie erfolgreich ausgeführt (`last_cleanup_at: null`).

Dabei haben wir 103.409 energy_readings seit dem 5. Januar -- genug Daten für 5+ Wochen.

**Lösung:** Die `aggregate-energy-data` Funktion so überarbeiten, dass `daily_patterns` **täglich** aus `energy_readings` erstellt werden, unabhängig von der Retention-Logik. Zusätzlich einmalig die historischen Tage nachfüllen.

**Technische Änderungen in `aggregate-energy-data/index.ts`:**

1. Neuen Step 0 einfügen: **Daily Patterns direkt aus energy_readings erstellen**
   - Für jeden Tag mit energy_readings (gruppiert nach lokalem Datum)
   - Peak Power, Avg Power, Total Energy In/Out berechnen
   - In `daily_patterns` upserten
   - Das passiert **vor** der Retention-Cleanup-Logik, also unabhängig davon

2. Den bestehenden Step 2 (daily_patterns aus hourly_aggregates) als Fallback beibehalten

```text
Neuer Ablauf:
+----------------------------------+
| Step 0: Daily Patterns erstellen |
| (aus energy_readings, alle Tage) |
+----------------------------------+
           |
+----------------------------------+
| Step 1: Raw -> Hourly Aggregates |
| (bestehende Logik)               |
+----------------------------------+
           |
+----------------------------------+
| Step 2: Hourly -> Daily Patterns |
| (Fallback, bestehende Logik)     |
+----------------------------------+
```

3. Historische Daten: Beim ersten Lauf werden alle Tage seit 5. Januar automatisch befüllt, da Step 0 über alle vorhandenen energy_readings iteriert.

**Zusätzlich:** Einen Cron-Job für `aggregate-energy-data` einrichten (falls noch nicht vorhanden), damit die Funktion täglich läuft.

---

## Zusammenfassung der Dateien

| Datei | Änderung |
|---|---|
| `supabase/functions/aggregate-energy-data/index.ts` | Neuer Step 0: daily_patterns direkt aus energy_readings erstellen |
| SQL (Insert Tool) | Reset learning_events: `is_evaluated = false` |
| SQL (Insert Tool) | Cron-Job für aggregate-energy-data (falls nötig) |
| Edge Function Calls | evaluate-decision, update-learned-policies, aggregate-energy-data manuell aufrufen |

## Risiken

- Die Re-Evaluation von 88k Events dauert in 50er-Batches ca. 1.700 Aufrufe -- das ist nicht praktikabel über die Edge Function. Alternativ: Batch-Größe im Code auf 500 erhöhen, oder die Re-Evaluation in einem einzigen Lauf mit größerem Limit durchführen.
- Die daily_patterns Berechnung aus 103k Readings braucht Paginierung (1000er Limit bei Supabase-Queries).

