

# Fix: Auto-Discovery Script bekommt keine Daten wegen RLS

## Problem
Das `auto-discover.js` Script verbindet sich mit dem anon-Key zur Datenbank, ist aber **nicht eingeloggt**. Die `rooms`-Tabelle hat nur eine RLS-Policy fuer authentifizierte Benutzer. Daher gibt die Abfrage 0 Zeilen zurueck.

## Loesung

### 1. RLS-Policy fuer anonymen Lesezugriff auf `rooms`

Eine neue SELECT-Policy hinzufuegen, die anonymen Lesezugriff auf die rooms-Tabelle erlaubt. Dies ist konsistent mit dem bestehenden Muster (z.B. `energy_readings` hat bereits eine anonyme INSERT-Policy fuer den Collector).

```sql
CREATE POLICY "Allow anonymous select for collector"
  ON public.rooms
  FOR SELECT
  USING (true);
```

### 2. Anonymen INSERT auf `thermostat_commands` erlauben

Der Collector muss auch Thermostat-Befehle lesen und aktualisieren koennen:

```sql
CREATE POLICY "Allow anonymous select for collector"
  ON public.thermostat_commands
  FOR SELECT
  USING (true);

CREATE POLICY "Allow anonymous update for collector"
  ON public.thermostat_commands
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
```

### 3. Anonymen UPDATE auf `rooms` erlauben

Das auto-discover Script muss `thermostat_local_ip` in die rooms-Tabelle schreiben:

```sql
CREATE POLICY "Allow anonymous update for collector"
  ON public.rooms
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
```

## Sicherheitshinweis
Diese Policies erlauben oeffentlichen Zugriff auf die Tabellen. Da die App nur im lokalen Netzwerk verwendet wird und der anon-Key bereits im Collector-Script enthalten ist, ist das Risiko gering. Fuer hoehere Sicherheit koennte man stattdessen eine Service-Role-Key-basierte Authentifizierung im Script verwenden.

## Technische Details
- Betroffene Tabellen: `rooms`, `thermostat_commands`
- Neue Policies: 3 (SELECT rooms, SELECT+UPDATE thermostat_commands, UPDATE rooms)
- Keine Code-Aenderungen am auto-discover.js Script noetig

