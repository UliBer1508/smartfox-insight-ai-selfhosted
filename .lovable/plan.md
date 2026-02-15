

# Fix: Datenbank-Timeouts durch fehlende Indexes

## Problem
Alle Datenbankabfragen scheitern mit "canceling statement due to statement timeout". Die `energy_readings`-Tabelle ist so gross geworden, dass Abfragen ohne Index nicht mehr innerhalb des Zeitlimits abgeschlossen werden.

Betroffene Bereiche:
- Batterie-Status: keine Daten
- PV-Leistung: keine aktuelle Anzeige
- Heizverbrauch: "Lade Daten..."
- Kostenuebersicht: "Laden..."

## Loesung

### 1. Indexes erstellen

Kritische Indexes fuer die am haeufigsten genutzten Abfragen:

```sql
-- Wichtigster Index: energy_readings nach timestamp (fuer ORDER BY DESC LIMIT 100)
CREATE INDEX IF NOT EXISTS idx_energy_readings_timestamp 
  ON energy_readings (timestamp DESC);

-- room_heating_logs nach timestamp (fuer Heizverbrauch-Abfrage)
CREATE INDEX IF NOT EXISTS idx_room_heating_logs_timestamp 
  ON room_heating_logs (timestamp DESC);

-- energy_daily_costs nach date (fuer Kostenuebersicht)
CREATE INDEX IF NOT EXISTS idx_energy_daily_costs_date 
  ON energy_daily_costs (date);
```

### 2. totalCount-Abfrage entschaerfen

Die Abfrage `SELECT *, count: exact, head: true` auf `energy_readings` fuehrt einen Full-Table-Scan durch. Diese wird durch eine geschaetzte Variante ersetzt, die keinen Scan benoetigt.

### 3. Alte Rohdaten bereinigen (optional)

Falls die Tabelle extrem gross ist, sollten aeltere Rohdaten geloescht werden. Die `data_retention_settings` sieht 7 Tage fuer Rohdaten vor, aber die Bereinigung lief offenbar nicht oder nicht regelmaessig.

## Technische Details

Dateien die geaendert werden:

- **Neue Migration**: Indexes auf `energy_readings`, `room_heating_logs`, `energy_daily_costs`
- **`src/hooks/useSmartfoxData.ts`**: `loadTotalCount` durch geschaetzte Variante ersetzen oder ganz entfernen, um den Full-Table-Scan zu vermeiden

Die Indexes allein sollten das Problem sofort beheben, da die haeufigsten Abfragen (`ORDER BY timestamp DESC LIMIT N`) dann den Index nutzen koennen statt die gesamte Tabelle zu scannen.

