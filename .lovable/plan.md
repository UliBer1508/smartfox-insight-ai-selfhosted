

# Analyse: Effizienz-Sortierung und Priorität im aktuellen Code

## Ist-Zustand

Die Effizienz-basierte Sortierung **ist bereits implementiert** (Zeilen 755-764):

```text
Sortier-Reihenfolge (aktuell):
1. priority (1 vor 2 vor 3)        ← Priorität WIRD verwendet
2. tempDeficit > 0.5°C Differenz   ← Größeres Defizit zuerst
3. energy_per_degree_wh            ← Effizienz (niedrig = schnell)
4. waitTimeMinutes                 ← Wartezeit als Tiebreaker
```

**Die Priorität wird also bereits als erstes Kriterium herangezogen.** Ein Raum mit `priority=1` wird IMMER vor einem Raum mit `priority=2` im Budget berücksichtigt.

## Mögliches Problem

Die meisten Räume haben vermutlich den **Default-Wert `priority=2`**, wodurch die Prioritäts-Sortierung keinen Effekt hat und alle Räume gleich behandelt werden. Erst bei unterschiedlichen Prioritäten greift die Logik.

## Plan

### 1. Logging verbessern (pv-automation/index.ts)

Nach der Sortierung die resultierende Reihenfolge loggen, damit man in den Logs sieht welcher Raum in welcher Position steht und warum:

```
[PV-Automation] Heiz-Reihenfolge:
  1. Zimmer Luis (Prio 1, Defizit 1.2°C, 345 Wh/°C)
  2. Büro (Prio 2, Defizit 0.8°C, 1578 Wh/°C)
  3. Wirtschaftsraum (Prio 3, Defizit 0.3°C, 1781 Wh/°C)
```

### 2. Rotation: Priorität stärker berücksichtigen

Aktuell (Zeile 784) wird ein Raum nur rotiert wenn ein wartender Raum `priority <= aktuellerRaum` hat. **Verbesserung**: Räume mit niedrigerer Prioritätszahl (=wichtiger) sollten nie für Räume mit höherer Zahl rotiert werden, und bei gleicher Priorität entscheidet die Effizienz.

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | Sortierungs-Logging nach Zeile 764, Rotation-Logik verschärfen |

