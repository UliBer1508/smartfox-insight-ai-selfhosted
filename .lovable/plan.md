
# Fix: Fehlende Fehleranzeige bei Datenbank-Ausfall

## Problem

Wenn die Datenbank temporaer nicht erreichbar ist (503-Fehler), werden Raeume und Thermostate einfach nicht angezeigt - ohne Fehlermeldung. Der Benutzer sieht nur leere Bereiche und weiss nicht, warum.

Die aktuelle Situation: Alle REST-API-Anfragen an die Datenbank schlagen mit 503 (Service Unavailable) fehl. Die Datenbank hat wiederholt Verbindungsprobleme.

## Loesung

### 1. useRooms Hook - Fehlerstatus hinzufuegen (src/hooks/useRooms.ts)

- Neuen State `error` (boolean) hinzufuegen
- Bei Ladefehler `error = true` setzen, bei Erfolg `error = false`
- `error` und eine `retry`-Funktion zurueckgeben

### 2. HeatingDashboard - Fehleranzeige (src/components/heating/HeatingDashboard.tsx)

- Wenn `rooms` leer sind UND ein Fehler vorliegt: eine Alert-Komponente mit "Datenbank nicht erreichbar" und einem "Erneut versuchen"-Button anzeigen
- Automatischer Retry nach 30 Sekunden

### 3. SettingsPanel - Fehleranzeige (src/components/energy/SettingsPanel.tsx)

- Gleiche Fehleranzeige im Raeume-Bereich der Einstellungen

## Technische Details

Aenderungen in 3 Dateien:

**useRooms.ts**: 
- `const [error, setError] = useState(false);` hinzufuegen
- Im catch-Block: `setError(true)` setzen
- Im try-Block nach erfolgreicher Abfrage: `setError(false)` setzen
- Return-Objekt um `error` erweitern

**HeatingDashboard.tsx**:
- `error` aus `useRooms()` destrukturieren  
- Vor der Thermostat-Sektion eine bedingte Alert-Komponente einfuegen die bei `error && rooms.length === 0` angezeigt wird
- Alert mit AlertCircle-Icon, Fehlermeldung und "Erneut laden"-Button

**SettingsPanel.tsx**:
- `error` aus `useRooms()` destrukturieren (bereits `isLoading` vorhanden)
- Im Raeume-Akkordeon-Bereich eine bedingte Fehleranzeige

## Ergebnis

- Der Benutzer sieht eine klare Meldung wenn die Datenbank nicht erreichbar ist
- Ein "Erneut versuchen"-Button ermoeglicht manuelles Neuladen
- Das Problem bleibt ein temporaerer Infrastruktur-Ausfall - der Code ist nicht fehlerhaft
