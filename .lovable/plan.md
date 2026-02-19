

# Bereinigung: Alte api_errors und pending thermostat_commands

## Was wird bereinigt

| Daten | Anzahl | Aktion |
|-------|--------|--------|
| Alte pending Commands (6. Februar) | 10 | Status auf "expired" setzen |
| Gelöste api_errors | 1.724 | Löschen |
| Ungelöste api_errors älter als 24h | variabel | Löschen (veraltet) |
| Heutige pending Commands | 4 | Behalten (für lokalen Service) |

## Technische Umsetzung

Eine temporäre Edge Function `cleanup-stale-data` wird erstellt, die:

1. Alle `thermostat_commands` mit Status "pending" vom 6. Februar auf "expired" setzt
2. Alle bereits gelösten `api_errors` (resolved_at IS NOT NULL) löscht
3. Alle ungelösten `api_errors` älter als 24 Stunden löscht (diese sind veraltet und nicht mehr relevant)
4. Die verbleibenden Einträge zählt und als Ergebnis zurückgibt

Die heutigen 4 pending Commands bleiben erhalten, damit der lokale Thermostat-Service sie noch verarbeiten kann.

Nach erfolgreicher Ausführung kann die Edge Function wieder entfernt werden.

