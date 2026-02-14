

# Collector v2.0 auf lokale Tuya-Steuerung erweitern

## Ausgangslage

Die hochgeladene `index.js` ist der aktuell laufende Collector (v2.0) - rein Fronius, 190 Zeilen, ohne Tuya. Die v3.0 im Repository hat bereits Tuya-Code, aber mit falschem DPS-Mapping (numerisch statt alphanumerisch).

## Aenderungen

### 1. `tuya-thermostat.js` - DPS-Mapping korrigieren

Das bestehende Mapping ist falsch:

```text
Aktuell (falsch):           Korrekt (TGP508):
MODE: '1'                   MODE: 'mode'
TARGET_TEMP: '2'             TARGET_TEMP: 'temp_set'
CURRENT_TEMP: '3'            CURRENT_TEMP: 'temp_current'
HEATING: '4'                 SWITCH: 'switch'
```

Zusaetzlich: Dual-Format-Fallback in `getStatus` - probiert zuerst alphanumerische Keys, dann numerische als Fallback.

### 2. `index.js` - Tuya-Integration in den v2.0 Collector einbauen

Folgende Bloecke werden zum bestehenden Fronius-Collector hinzugefuegt:

- **Import**: ThermostatController laden (wenn `config.tuya.enabled`)
- **syncThermostats()**: Alle Thermostate lesen, `rooms`-Tabelle aktualisieren
- **processCommands()**: Pending Commands aus `thermostat_commands`-Tabelle ausfuehren (set_temp, set_mode)
- **poll()**: syncThermostats und processCommands in den Polling-Loop integrieren
- **Graceful Shutdown**: Alle TuyAPI-Verbindungen sauber schliessen

Die Fronius-Logik bleibt 1:1 erhalten.

### 3. `generate-config.js` - Neues Script

Generiert `config.json` automatisch aus der `rooms`-Tabelle:

- Liest `tuya_device_id`, `local_key`, `thermostat_local_ip` und `name` aus der Datenbank
- Erstellt vollstaendige config mit Fronius-IP und allen Tuya-Devices
- Warnt bei fehlenden IPs

Aufruf: `node generate-config.js --fronius-ip 192.168.188.64`

### 4. Voraussetzung: Lokale IPs eintragen

Die `thermostat_local_ip` Spalte in der `rooms`-Tabelle ist bei allen Raeumen noch `null`. Die IPs muessen aus dem Router (DHCP-Liste) den Raeumen zugeordnet und per SQL-Update eingetragen werden.

Bekannte Thermostat-IPs im Netzwerk:
```text
192.168.188.42, .43, .68, .78, .79, .107, .114, .171, .173, .186, .197
```

## Dateien

| Datei | Aktion |
|---|---|
| `local-collector/collector-node/tuya-thermostat.js` | DPS-Mapping auf `mode`, `temp_set`, `temp_current`, `switch` aendern |
| `local-collector/collector-node/index.js` | Tuya-Integration (syncThermostats, processCommands) in v2.0 einbauen |
| `local-collector/collector-node/generate-config.js` | Neues Script: Config aus Datenbank generieren |

## Ablauf nach Implementation

1. IPs im Router nachschlagen und Raeumen zuordnen
2. IPs per SQL in `rooms.thermostat_local_ip` eintragen
3. `node generate-config.js --fronius-ip 192.168.188.64` ausfuehren
4. `npm install tuyapi` im collector-node Verzeichnis
5. `npm start` - Collector laeuft mit Fronius + lokaler Thermostat-Steuerung

