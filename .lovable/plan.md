

## Plan: Syntax-Error Fix + 9:00 Eco-Start sicherstellen

### Problem 1: Function ist komplett kaputt
Die pv-automation hat einen **Syntax-Error** und läuft seit dem letzten Deploy nicht mehr:
```
Uncaught SyntaxError: Identifier 'currentWienHour' has already been declared (line 1319)
```
`currentWienHour` wird zweimal mit `const` deklariert — Zeile 882 und Zeile 1513.

### Problem 2: Eco-Heizung vor 9:00
Die Tagesplanung mit Prognose-basiertem Budget könnte Eco-Heizung vor 9:00 erlauben, weil das `forecastMinBudget` unabhängig von der Uhrzeit berechnet wird.

### Änderungen in `supabase/functions/pv-automation/index.ts`

**1. Syntax-Error fixen** (Zeile 1513)
- Die zweite Deklaration `const { wienHour: currentWienHour }` umbenennen zu z.B. `const { wienHour: policyWienHour }` und alle Referenzen in dem Block anpassen (Zeilen 1520, 1526).

**2. Eco erst ab 9:00 erlauben** 
- Im Prognose-Budget-Block prüfen: `if (currentWienHour >= 9)` bevor `forecastMinBudget` angewendet wird
- Vor 9:00 bleibt das System im Nacht-Modus (frost_only oder maintain)

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeile 1513 (Duplikat), Budget-Block (~Zeile 990)

