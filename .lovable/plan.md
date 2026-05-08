## Problem

Der Banner zeigt "Thermostat-Verbindungsfehler Waschraum/Toilette" an, obwohl der Collector aktuell sauber läuft.

**Ursache:** Es sind **22 uralte Fehler** in `api_errors` offen — vom **19. Februar** und **20. April 2026**. Sie wurden damals nie als `resolved` markiert. Da der Banner alle nicht-resolved Fehler zeigt, hängen die seit Wochen sichtbar.

**Aktueller Status:** Console zeigt `[ActiveHeatingRooms] Stufe A (Logs): 1` — die Heizung wird live korrekt erkannt. Keine neuen `connection_error`/`token_expired`-Einträge seit dem 26. April.

## Fix — DB-Aufräumen

Alle veralteten Verbindungsfehler (älter als 1 Stunde) als resolved markieren:

```sql
UPDATE api_errors
SET resolved_at = NOW(), is_acknowledged = true
WHERE resolved_at IS NULL
  AND error_type IN ('connection_error', 'token_expired')
  AND created_at < NOW() - INTERVAL '1 hour';
```

Betrifft 22 Einträge (alle Räume, Stand vor heute).

## Resultat

- Banner verschwindet sofort
- Falls **echter** neuer Verbindungsfehler auftritt (Collector down, Thermostat offline), erscheint er ganz normal wieder im Banner
- Cloud-Modus-spezifische Fehler (`token_expired`) sind im aktuellen Local-Modus ohnehin durch den Banner-Filter ausgeblendet