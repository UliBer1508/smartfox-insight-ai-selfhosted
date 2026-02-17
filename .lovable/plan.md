

# Datenbank-Stabilisierung: PGRST002 Schema-Cache Überlastung beheben

## Analyse-Ergebnis

Der Collector stimmt mit der Datenbankstruktur ueberein - alle Versionen (v1.0 bis v3.0) schreiben korrekt in die `energy_readings` Tabelle. Das Problem ist ein Infrastruktur-Problem: **Alle API-Anfragen scheitern mit HTTP 503 / PGRST002** ("Could not query the database for the schema cache").

## Ursache

Die Datenbank ist ueberlastet durch:
1. Zu viele gleichzeitige Realtime-Subscriptions (die App oeffnet mehrere Channels gleichzeitig)
2. Grosse Tabellen ohne ausreichende Indizes fuer haeufige Abfragen
3. Moegliche lang laufende Queries die Ressourcen blockieren

## Loesung

### Schritt 1: Realtime-Subscriptions reduzieren
**Datei:** `src/hooks/useSmartfoxData.ts`

Die App abonniert wahrscheinlich mehrere Realtime-Channels gleichzeitig. Diese muessen auf maximal 1-2 reduziert werden, da jeder Channel eine persistente DB-Verbindung haelt.

### Schritt 2: Fehlende Indizes hinzufuegen
**SQL Migration** fuer die am haeufigsten abgefragten Spalten:

```text
- energy_readings: Index auf (timestamp DESC) -- haeufigste Abfrage
- room_heating_logs: Index auf (timestamp DESC, event_type)
- learning_events: Index auf (created_at DESC)
- api_errors: Index auf (created_at DESC, resolved_at)
```

### Schritt 3: Alte Daten bereinigen
Sofortige Bereinigung der grossen Tabellen um die DB-Last zu reduzieren:
- `learning_events` aelter als 30 Tage loeschen
- `api_errors` (geloeste) aelter als 7 Tage loeschen
- `room_heating_logs` aelter als 90 Tage loeschen

### Schritt 4: Query-Optimierung in den Hooks
**Dateien:** Diverse Hooks (`useSmartfoxData`, `useRooms`, `useBatteryHistory`, etc.)

- Abfragen nur die noetigsten Spalten selektieren (statt `select('*')`)
- Limits reduzieren wo moeglich (z.B. `limit=5000` auf `limit=500`)
- Retry-Logik bei PGRST002 verbessern (exponential backoff)

## Technische Details

### Indizes (SQL Migration)
```text
CREATE INDEX IF NOT EXISTS idx_energy_readings_timestamp 
  ON energy_readings (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_room_heating_logs_timestamp_type 
  ON room_heating_logs (timestamp DESC, event_type);

CREATE INDEX IF NOT EXISTS idx_learning_events_created 
  ON learning_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_errors_created 
  ON api_errors (created_at DESC);
```

### Realtime-Reduktion
Statt separate Subscriptions fuer `energy_readings`, `rooms`, `thermostat_commands` etc. wird nur **ein einziger Channel** verwendet, der die noetigsten Tabellen abhoert. Alternativ: Realtime komplett deaktivieren und stattdessen Polling mit 30-60s Intervall verwenden.

### Retry-Logik
Bei PGRST002-Fehlern: Warten von 2s, 4s, 8s (exponential backoff) statt sofortiger Retry alle 5s.

## Erwartete Auswirkungen
- Datenbank wird entlastet und antwortet wieder mit HTTP 200
- App zeigt wieder Daten an
- Collector kann wieder Daten schreiben
- Langfristig stabile Performance durch Indizes

## Dateien zu aendern
1. SQL Migration (neue Datei) -- Indizes + Datenbereinigung
2. `src/hooks/useSmartfoxData.ts` -- Realtime reduzieren
3. `src/hooks/useRooms.ts` -- Realtime reduzieren  
4. Diverse Hooks -- Query-Optimierung + besseres Retry

## Risiken
- **Gering**: Indizes erhoehen den Speicherbedarf minimal
- **Gering**: Reduktion der Realtime-Subscriptions bedeutet etwas langsamere UI-Updates (Polling statt Echtzeit)
- **Mittel**: Datenbereinigung loescht alte Daten unwiderruflich (aber nur Logs, keine Konfiguration)

