

# Bug-Fix: PV-Automation crasht — `rooms` wird vor Deklaration verwendet

## Problem
Die pv-automation Edge Function crasht bei **jedem Aufruf** mit:
```
ReferenceError: Cannot access 'rooms' before initialization
```

**Ursache:** Zeile 721 referenziert `rooms?.length` **bevor** die Variable auf Zeile 735 mit `let` deklariert wird. JavaScript's Temporal Dead Zone verhindert den Zugriff.

Das bedeutet: **Kein Raum wird aktuell geheizt** — weder Eco noch Komfort. Deshalb bleibt Bad Uli auf Eco stehen (der letzte Wert bevor der Fehler auftrat).

## Fix

### Datei: `supabase/functions/pv-automation/index.ts`

**Zeile 721** — die Referenz auf `rooms` durch `'unbekannt'` oder `0` ersetzen, da die Raumdaten zu diesem Zeitpunkt noch nicht geladen sind:

```typescript
// Vorher (Zeile 721):
console.log(`... (${rooms?.length || 0} Räume)`);

// Nachher:
console.log(`... überspringe Raum-Verarbeitung komplett`);
```

Das ist ein Ein-Zeilen-Fix, der den Crash behebt. Danach läuft die 2-Phasen-Logik (Eco → Komfort) wieder korrekt und Bad Uli wird sequentiell auf die richtige Stufe geheizt.

### Deployment
- Edge Function `pv-automation` neu deployen
- Beim nächsten 2-Minuten-Zyklus werden die Räume wieder korrekt verarbeitet

