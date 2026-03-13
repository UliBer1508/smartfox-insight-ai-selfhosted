

# Analyse-Häufigkeit reduzieren: Was wirklich nötig ist

## Aktuelle Situation

`pv-automation` läuft alle **2 Minuten** und ruft **jedes Mal** `analyze-patterns` mit `optimize_decision` auf (Zeile 842-858). Das sind **720 AI-Aufrufe/Tag** bei einem Limit von **20/Tag**.

## Was passiert wirklich alle 2 Minuten?

Die `pv-automation` macht zwei völlig verschiedene Dinge:

1. **Hardcoded Budget-Logik** (Zeilen 668-810): Berechnet Budget aus `gridExport`, sortiert Räume nach Priorität, rotiert Heizung — **braucht KEINE KI**, arbeitet mit aktuellen Sensordaten
2. **ML-Entscheidungen** (Zeilen 838-943): Ruft Google AI auf für Temperatur-Empfehlungen — **braucht NICHT alle 2 Min**, weil sich die Grundsituation (Wetter, PV-Prognose, Raumtemperaturen) nur langsam ändert

Zusätzlich: **Learned Policies** (Zeile 1089) werden bereits bevorzugt wenn genug Daten da sind. Die KI wird nur als "Exploration"-Fallback gebraucht.

## Wie oft ist eine KI-Analyse wirklich nötig?

| Faktor | Änderungsrate | Fazit |
|--------|---------------|-------|
| PV-Prognose | 1x/Tag | KI braucht das nicht alle 2 Min |
| Wetter | ~stündlich | Alle 30-60 Min reicht |
| Raumtemperaturen | ~0.1°C/10 Min | Alle 30 Min reicht |
| gridExport | Sekündlich | Wird von Budget-Logik gehandelt, NICHT von KI |
| Batterie-SOC | ~1%/5 Min | Alle 15-30 Min reicht |

**Ergebnis: KI-Analyse alle 30 Minuten reicht völlig aus.** Die Budget-Logik läuft weiterhin alle 2 Minuten für schnelle Reaktionen.

## Plan

### Änderung in `pv-automation/index.ts`

Cache die letzte ML-Entscheidung in der Datenbank (`system_settings` Tabelle, Key `last_ml_cache`) und verwende sie wieder, solange sie < 30 Minuten alt ist:

```text
Vor dem AI-Aufruf (Zeile 838):

1. Lade system_settings['last_ml_cache']
2. Prüfe: Cache vorhanden UND < 30 Min alt?
   JA → verwende gecachte mlDecisions, überspringe AI-Aufruf
   NEIN → rufe analyze-patterns auf, speichere Ergebnis in Cache

Ausnahme: Cache wird invalidiert wenn sich SOC oder PV-Power 
um >30% geändert haben (signifikante Änderung)
```

- Kein In-Memory-Cache (Edge Functions haben keinen persistenten State zwischen Aufrufen)
- Nutzt bestehende `system_settings` Tabelle (hat bereits public INSERT/UPDATE/SELECT Policies)

### Budget: ~16 AI-Aufrufe/Tag bei Tageslicht (6-22 Uhr = 16h ÷ 30 Min = 32, aber Learned Policies übernehmen oft → ~16 tatsächliche Aufrufe)

### Dateien

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | ML-Cache-Logik vor AI-Aufruf (Zeilen 838-858) |

Keine neuen Tabellen, keine neuen Functions, keine Frontend-Änderungen nötig.

