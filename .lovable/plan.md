

# Collector-Zugriff sicherstellen (Anon-Policies zurück)

## Problem

Die letzte Sicherheitsmigration hat alle anonymen RLS-Policies entfernt. Der lokale Collector nutzt aber aktuell noch den `anon_key` (kein `service_role_key` in der config.json). Ohne Anon-Policies kann der Collector keine Daten mehr schreiben/lesen.

## Lösung

Anon-Policies für genau die Tabellen und Operationen wiederherstellen, die der Collector benötigt:

| Tabelle | Operation | Grund |
|---------|-----------|-------|
| `energy_readings` | INSERT | Fronius-Messwerte speichern |
| `rooms` | SELECT, UPDATE | Thermostat-Status lesen/synchronisieren |
| `thermostat_commands` | SELECT, UPDATE | PWA-Befehle abholen und ausführen |
| `api_errors` | INSERT, UPDATE | Fehler loggen und auflösen |
| `data_retention_settings` | SELECT | Polling-Intervall auslesen |

## Änderung

**Datenbank-Migration:** 5 neue RLS-Policies mit `USING (true)` / `WITH CHECK (true)` für die Rolle `anon`, beschränkt auf die jeweiligen Operationen. Die bestehenden `authenticated`-Policies bleiben unverändert.

So funktioniert der Collector sofort wieder, ohne dass du vor Ort die config.json ändern musst. Sobald du den `service_role_key` einträgst, können diese Anon-Policies optional wieder entfernt werden.

