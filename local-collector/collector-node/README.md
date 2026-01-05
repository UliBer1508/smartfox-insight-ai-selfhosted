# Smartfox/Fronius Collector (Node.js)

Lokaler Datensammler für Smartfox und Fronius Geräte.

## Schnellstart (ohne Installation)

### Option 1: Fertige .exe verwenden

1. Lade `smartfox-collector.exe` und `config.json` herunter
2. Kopiere beide Dateien in einen Ordner
3. Öffne `config.json` und passe die IP-Adressen an:
   ```json
   {
     "smartfox": {
       "ip": "192.168.1.100",  ← Deine Smartfox IP
       "enabled": true
     },
     "fronius": {
       "ip": "192.168.1.101",  ← Deine Fronius IP
       "enabled": true
     }
   }
   ```
4. Doppelklick auf `smartfox-collector.exe`

### Option 2: Mit Node.js ausführen

1. [Node.js installieren](https://nodejs.org/) (Version 18+)
2. In diesen Ordner wechseln:
   ```bash
   cd local-collector/collector-node
   ```
3. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
4. Konfiguration erstellen:
   ```bash
   copy config.example.json config.json
   ```
5. `config.json` bearbeiten und IP-Adressen anpassen
6. Starten:
   ```bash
   npm start
   ```

## Selbst .exe bauen

```bash
npm install
npm run build
```

Die fertige `smartfox-collector.exe` liegt dann im `dist/` Ordner.

## Konfiguration

| Einstellung | Beschreibung |
|-------------|--------------|
| `smartfox.ip` | IP-Adresse deines Smartfox |
| `smartfox.enabled` | `true` oder `false` |
| `fronius.ip` | IP-Adresse deines Fronius Wechselrichters |
| `fronius.enabled` | `true` oder `false` |
| `polling_interval_seconds` | Abfrageintervall in Sekunden |

## Troubleshooting

### Smartfox nicht erreichbar
- Teste im Browser: `http://DEINE-SMARTFOX-IP/all`
- Stelle sicher, dass dein PC im selben Netzwerk ist

### Fronius nicht erreichbar
- Teste im Browser: `http://DEINE-FRONIUS-IP/solar_api/v1/GetPowerFlowRealtimeData.fcg`
- Bei Gen24 Wechselrichtern muss die API ggf. aktiviert werden

### Datenbank-Fehler
- Überprüfe deine Internetverbindung
- Die Supabase-Konfiguration ist voreingestellt und sollte funktionieren

## Autostart unter Windows

1. Erstelle eine Verknüpfung zu `smartfox-collector.exe`
2. Drücke `Win+R` und gib `shell:startup` ein
3. Verschiebe die Verknüpfung in den geöffneten Ordner
