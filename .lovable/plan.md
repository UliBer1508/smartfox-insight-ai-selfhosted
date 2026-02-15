
# Fix: Thermostat IP-Feld vereinheitlichen

## Problem
Es gibt zwei IP-Spalten in der `rooms`-Tabelle:
- `thermostat_ip` - wird vom UI-Formular (RoomManager) beschrieben - **alle 12 IPs sind hier gespeichert**
- `thermostat_local_ip` - wird vom Collector und auto-discover Script gelesen - **alle NULL**

Die IPs wurden korrekt ueber das Formular eingetragen, landen aber in der falschen Spalte.

## Loesung

### 1. Daten kopieren (SQL UPDATE)
Die vorhandenen IPs von `thermostat_ip` nach `thermostat_local_ip` kopieren:

```sql
UPDATE rooms 
SET thermostat_local_ip = thermostat_ip 
WHERE thermostat_ip IS NOT NULL;
```

### 2. Code vereinheitlichen
Das Formular und den Code auf eine einzige Spalte (`thermostat_local_ip`) umstellen:

**Datei: `src/components/heating/RoomManager.tsx`**
- Formularfeld von `thermostat_ip` auf `thermostat_local_ip` aendern
- Default-Wert im Initial-State anpassen

**Datei: `src/types/room.ts`**
- Keine Aenderung noetig (beide Felder sind bereits definiert)

### 3. Ergebnis
- Der Collector findet die IPs in `thermostat_local_ip`
- Das UI-Formular schreibt direkt in `thermostat_local_ip`
- `auto-discover.js` und `generate-config.js` funktionieren korrekt
- Alle 12 Thermostate sind sofort einsatzbereit fuer die lokale Steuerung
