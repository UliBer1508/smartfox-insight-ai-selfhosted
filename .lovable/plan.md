

# Fix: Datenbank-Ueberlastung durch uebergrosse Tabellen

## Problem

Die Datenbank ist ueberlastet. Die Tabelle `learning_events` ist so gross, dass selbst ein einfaches `COUNT(*)` in einen Statement-Timeout laeuft. Das blockiert den PostgREST Schema-Cache (PGRST002-Fehler), wodurch KEINE einzige REST-API-Abfrage mehr funktioniert - auch nicht fuer kleine Tabellen wie `rooms` (12 Zeilen).

### Aktuelle Tabellen-Groessen:
- `api_errors`: 56.763 Zeilen (viel zu viel)
- `learning_events`: Timeout beim Zaehlen (geschaetzt 90.000+)
- `room_heating_logs`: 5.449 Zeilen (ok)
- `rooms`: 12 Zeilen (ok)

### Zugriffsrechte (RLS):
Die RLS-Policies sind korrekt konfiguriert. Das Problem ist NICHT die Zugriffsberechtigung, sondern die Datenbankueberlastung.

## Loesung

### Schritt 1: Sofortige Bereinigung (SQL Migration)

Alte Daten aus den uebergrossen Tabellen loeschen:

```text
-- api_errors: Nur neueste 200 behalten
DELETE FROM api_errors 
WHERE id NOT IN (
  SELECT id FROM api_errors ORDER BY created_at DESC LIMIT 200
);

-- learning_events: Nur neueste 1000 behalten
DELETE FROM learning_events 
WHERE id NOT IN (
  SELECT id FROM learning_events ORDER BY created_at DESC LIMIT 1000
);
```

Da die Tabellen so gross sind, wird das DELETE in kleineren Batches ausgefuehrt, um weitere Timeouts zu vermeiden:

```text
-- Batch-Delete fuer learning_events (aelteste zuerst)
DELETE FROM learning_events 
WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM learning_events 
WHERE created_at < NOW() - INTERVAL '60 days';

DELETE FROM learning_events 
WHERE created_at < NOW() - INTERVAL '30 days';

-- Dann auf 1000 reduzieren
DELETE FROM learning_events 
WHERE id NOT IN (
  SELECT id FROM learning_events ORDER BY created_at DESC LIMIT 1000
);
```

### Schritt 2: Indizes fuer schnellere Bereinigung

```text
CREATE INDEX IF NOT EXISTS idx_learning_events_created_at 
  ON learning_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_errors_created_at 
  ON api_errors(created_at DESC);
```

### Schritt 3: Automatische Bereinigungsfunktion

Eine Datenbankfunktion, die alte Daten automatisch loescht:

```text
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  DELETE FROM learning_events 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  DELETE FROM api_errors 
  WHERE resolved_at IS NOT NULL 
    AND created_at < NOW() - INTERVAL '7 days';
  
  DELETE FROM api_errors 
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Schritt 4: Retry-Logik in Hooks

Falls die Datenbank kurzzeitig nicht antwortet, automatisch erneut versuchen:

- **src/hooks/useRooms.ts**: Bei PGRST002-Fehler automatisch nach 5 Sekunden retry (max 3 Versuche)
- **src/hooks/useSmartfoxData.ts**: Gleiche Retry-Logik

## Erwartetes Ergebnis

Nach der Bereinigung:
- PostgREST Schema-Cache kann wieder aufgebaut werden
- Alle REST-API-Abfragen funktionieren wieder
- Raeume und Thermostate werden angezeigt
- Automatische Bereinigung verhindert zukuenftiges Ueberlaufen
