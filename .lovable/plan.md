
# Fix: ML-Analyse Guard in pv-automation

## Problem

In `supabase/functions/pv-automation/index.ts` (Zeile 810) ist der gesamte ML-Analyse-Block (`analyze-patterns` Aufruf + Persistierung der Ergebnisse) in eine Bedingung `if (tuyaAccessId && tuyaAccessSecret)` eingeschlossen. Das bedeutet: Wenn im Lokal-Modus keine Tuya Cloud Credentials gesetzt sind, wird die ML-Analyse komplett uebersprungen - obwohl sie keine Tuya-Credentials benoetigt.

## Loesung

Die Bedingung in Zeile 810 wird entfernt. Der Block bleibt bestehen, nur das `if`-Statement faellt weg. Konkret:

**Zeile 810**: `if (tuyaAccessId && tuyaAccessSecret) {` wird zu `{`

**Zeile 912**: Die zugehoerige schliessende Klammer `}` bleibt unveraendert (der Block-Scope bleibt erhalten).

## Betroffene Datei

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/pv-automation/index.ts` | Zeile 810: Guard-Bedingung entfernen, Block beibehalten |

Das ist ein Ein-Zeilen-Fix. Die ML-Analyse und Persistierung laufen danach unabhaengig davon, ob Tuya Cloud Credentials vorhanden sind.
