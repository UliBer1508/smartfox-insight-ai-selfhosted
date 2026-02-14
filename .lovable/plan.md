

# Temporären Re-Evaluation-Cron entfernen

## Aktueller Status

- **39.667 von 88.871 Events** sind evaluiert (45%)
- **49.204 Events** stehen noch aus
- Bei 50 Events / 2 Min dauert es noch ca. **33 Stunden** (voraussichtlich fertig am ~16. Februar morgens)
- Der temporaere Cron-Job ist **Job 8** (`evaluate-decision-batch`, `*/2 * * * *`)

## Vorgehen

### Option A: Jetzt warten, spaeter entfernen (empfohlen)

1. **Fortschritt pruefen** per SQL-Abfrage:
   ```
   SELECT COUNT(*) FILTER (WHERE is_evaluated = false) as pending FROM learning_events
   ```
2. **Sobald pending = 0**: Cron-Job entfernen mit:
   ```sql
   SELECT cron.unschedule(8);
   ```

### Option B: Jetzt entfernen

- Sofort `SELECT cron.unschedule(8);` ausfuehren
- Die restlichen 49k Events bleiben unevaluiert bis sie durch den normalen Betrieb (neue Events alle 2h) nachlaufen -- das wuerde Monate dauern
- **Nicht empfohlen**, da die Policies dann auf unvollstaendigen Daten basieren

## Empfehlung

Warte bis die Re-Evaluation abgeschlossen ist (ca. 33 Stunden). Dann melde dich hier und ich entferne den Cron-Job mit einem einzigen SQL-Befehl.

Alternativ kann ich den Job sofort entfernen, wenn du die restlichen Events nicht mehr brauchst.

## Technische Details

| Aktion | SQL |
|---|---|
| Fortschritt pruefen | `SELECT COUNT(*) FILTER (WHERE is_evaluated = false) as pending FROM learning_events` |
| Job entfernen | `SELECT cron.unschedule(8);` |
| Alle Jobs anzeigen | `SELECT jobid, jobname, schedule FROM cron.job` |

