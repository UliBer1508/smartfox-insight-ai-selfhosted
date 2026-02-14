

# Auto-Discovery Script: IPs automatisch den Raeumen zuordnen

## Was das Script macht

Das Script verbindet sich nacheinander zu allen 11 bekannten Thermostat-IPs per TuyAPI, liest die Device-ID aus und gleicht sie mit der `rooms`-Tabelle ab. Bei einem Match wird die `thermostat_local_ip` automatisch in der Datenbank eingetragen.

## Ablauf

```text
Fuer jede IP (192.168.188.42, .43, .68, .78, .79, .107, .114, .171, .173, .186, .197):
  1. TCP-Port 6668 pruefen (schneller Vorab-Check)
  2. TuyAPI connect mit allen bekannten Local Keys durchprobieren
  3. Bei Erfolg: Device-ID aus der Antwort lesen
  4. Device-ID in rooms-Tabelle suchen
  5. Match gefunden -> UPDATE rooms SET thermostat_local_ip = IP WHERE tuya_device_id = device_id
  6. Ergebnis ausgeben (zugeordnet / nicht gefunden / Fehler)
```

## Technische Details

### Neue Datei: `local-collector/collector-node/auto-discover.js`

- Liest alle Raeume mit `tuya_device_id` und `local_key` aus der Datenbank
- Versucht fuer jede der 11 IPs, sich mit jedem bekannten Local Key zu verbinden
- TuyAPI liefert bei erfolgreicher Verbindung die Device-ID zurueck
- Matched die Device-ID gegen die Datenbank und schreibt die IP per UPDATE
- Gibt eine Zusammenfassung aus: welche Raeume zugeordnet wurden, welche IPs keinen Match hatten

### Herausforderung: Local Key Matching

TuyAPI benoetigt den korrekten Local Key um sich zu verbinden. Da wir nicht wissen welcher Key zu welcher IP gehoert, probiert das Script alle 10 Keys pro IP durch. Bei falschem Key kommt ein Timeout/Fehler, bei richtigem Key eine erfolgreiche Verbindung mit Device-ID.

### Alternative (schnellerer Ansatz)

Falls das Durchprobieren aller Keys zu langsam ist, kann das Script auch `tinytuya scan` nutzen (UDP Broadcast auf Port 6666/6667), das die Device-ID ohne Key liefert. Dann reicht ein einfacher Abgleich Device-ID -> IP.

## Dateien

| Datei | Aktion |
|---|---|
| `local-collector/collector-node/auto-discover.js` | Neues Script erstellen |

## Aufruf

```text
cd local-collector/collector-node
npm install tuyapi    (falls noch nicht installiert)
node auto-discover.js
```

## Erwartete Ausgabe

```text
========================================
   Tuya Auto-Discovery v1.0
========================================
Lade 10 Raeume aus der Datenbank...

Scanne 11 IPs...

  192.168.188.42   -> Wohnzimmer (bf367d27...)   [ZUGEORDNET]
  192.168.188.43   -> Zimmer Luca (bf4b2068...)  [ZUGEORDNET]
  192.168.188.68   -> Buero (bf82697f...)         [ZUGEORDNET]
  ...
  192.168.188.197  -> Kein Match in der Datenbank [UEBERSPRUNGEN]

========================================
Ergebnis: 10/11 IPs zugeordnet, 1 ohne Match
thermostat_local_ip fuer 10 Raeume aktualisiert
========================================
```
