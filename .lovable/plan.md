## Problem

`auto-discovery.js` matcht 0/10 Thermostate, weil:

1. **Default-Protokollversion v3.3 wird getestet, alle TGP508 sprechen aber v3.5** (bestätigt durch snapshot.json: alle Geräte mit productKey `z3b3rp7ouquncuaz` haben `"ver": "3.5"`).
2. **Zwei DB-IPs sind veraltet** — DHCP hat neue IPs vergeben, deshalb „PORT GESCHLOSSEN":
   - Wohnzimmer: `192.168.188.171` → **`192.168.188.135`**
   - Haustür: `192.168.188.114` → **`192.168.188.174`**

## Lösung (3 Schritte, keine Code-Änderungen)

### Schritt 1: snapshot.json an die richtige Stelle legen
Du kopierst die hochgeladene Datei in den Service-Ordner:
```
C:\Users\ulibe\tuya-thermostat\tuya-thermostat-v2\snapshot.json
```
(Sie wurde aus dem alten collector-Ordner übernommen, war nur am falschen Ort.)

Damit liest `auto-discovery.js` für jedes Gerät die korrekte Protokoll-Version v3.5 statt der Default-Annahme v3.3.

### Schritt 2: DB-IPs für Wohnzimmer und Haustür korrigieren
Ein einziges UPDATE auf `rooms` setzt für beide Räume:
- `thermostat_ip` und `thermostat_local_ip` auf die aktuellen IPs aus snapshot.json.

```sql
UPDATE public.rooms
SET thermostat_ip = '192.168.188.135', thermostat_local_ip = '192.168.188.135'
WHERE name = 'Wohnzimmer';

UPDATE public.rooms
SET thermostat_ip = '192.168.188.174', thermostat_local_ip = '192.168.188.174'
WHERE name = 'Haustür';
```

### Schritt 3: Auto-Discovery erneut laufen lassen (du, lokal)
```cmd
cd C:\Users\ulibe\tuya-thermostat\tuya-thermostat-v2
node auto-discovery.js
```
Erwartet: **12/12 IPs erreichbar, 12/12 Match v3.5**.

## Was NICHT passiert

- Kein Eingriff in die Local Keys (die in der DB sind aller Wahrscheinlichkeit nach gültig — bestätigt sich beim erfolgreichen Match in Schritt 3).
- Keine Code-Änderungen am `tuya-thermostat-v2/` Service.
- Keine Edge-Function- oder UI-Änderungen.

## Falls Schritt 3 trotzdem fehlschlägt

Plan B liegt bereit:
- TinyTuya-Wizard ausführen → frische `devices.json` mit aktuellen Local Keys
- DB-Update aller `local_key`-Felder
- Erneuter Discovery-Lauf

Aber wahrscheinlich nicht nötig — die häufigste Ursache (falsche Version + alte IPs) wird mit den 2 Schritten behoben.
