# Fronius + Tuya Local Collector v3.0

Lokaler Collector für Energiedaten (Fronius) und Thermostat-Steuerung (Tuya) über LAN.

## Features

- **Fronius Datenerfassung**: Liest PV-Leistung, Batterie-SOC, Netzleistung und Verbrauch
- **Tuya Thermostat-Steuerung**: Direkte LAN-Kommunikation ohne Cloud-Limits
- **Command Queue**: PWA-Befehle werden über Supabase-Tabelle an Collector übermittelt
- **Automatische DB-Updates**: Thermostat-Status wird regelmäßig in `rooms` synchronisiert

## Schnellstart

### Option 1: Mit Node.js ausführen

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
   Dann `config.json` bearbeiten (siehe unten).
5. Starten:
   ```bash
   npm start
   ```

### Option 2: Als .exe bauen

```bash
npm install
npm run build
```

Die fertige `smartfox-collector.exe` liegt dann im `dist/` Ordner.

## Konfiguration

Bearbeite `config.json`:

```json
{
  "fronius": {
    "ip": "192.168.188.64"
  },
  "tuya": {
    "enabled": true,
    "sync_interval_seconds": 60,
    "devices": [
      {
        "name": "Zimmer Uli",
        "room_id": "UUID_AUS_ROOMS_TABELLE",
        "device_id": "bf2f469ec7aa367dbeeni9",
        "local_key": "16_ZEICHEN_AES_KEY",
        "ip": "192.168.188.50"
      }
    ]
  },
  "polling_interval_seconds": 30,
  "supabase": {
    "url": "https://xxx.supabase.co",
    "anon_key": "eyJ..."
  }
}
```

| Einstellung | Beschreibung |
|-------------|--------------|
| `fronius.ip` | IP-Adresse deines Fronius Wechselrichters |
| `tuya.enabled` | Thermostat-Steuerung aktivieren |
| `tuya.sync_interval_seconds` | Wie oft Thermostate synchronisiert werden |
| `tuya.devices` | Liste aller Thermostate mit Local Keys |
| `polling_interval_seconds` | Abfrageintervall für Fronius |

---

## Local Keys extrahieren

Die Local Keys werden für die verschlüsselte LAN-Kommunikation benötigt.

### Voraussetzungen

- Python 3.7+
- Tuya Developer Account mit verknüpften Geräten
- Geräte im lokalen Netzwerk erreichbar

### Schritt-für-Schritt

```bash
# 1. TinyTuya installieren
pip install tinytuya

# 2. Wizard starten (im lokalen Netzwerk!)
python -m tinytuya wizard

# Eingaben:
# - Access ID: [Tuya Developer Portal -> Cloud -> Projekt]
# - Access Secret: [Tuya Developer Portal -> Cloud -> Projekt]
# - Region: eu (Central Europe)
# - Device ID: [leer lassen für alle]
```

Der Wizard erstellt eine `devices.json` mit allen Local Keys:

```json
[
  {
    "name": "Thermostat Uli",
    "id": "bf2f469ec7aa367dbeeni9",
    "key": "a1b2c3d4e5f6g7h8",
    "ip": "192.168.188.50",
    "version": "3.3"
  }
]
```

### IP-Adressen scannen

```bash
python -m tinytuya scan
```

---

## Room-IDs ermitteln

Die `room_id` muss mit der UUID in der Supabase `rooms` Tabelle übereinstimmen.

So findest du die UUIDs:
1. Öffne die App → Heizung → Einstellungen eines Raums
2. Oder: Lovable Cloud → Database → rooms → id Spalte

---

## Datenfluss

```
PWA (Browser)
    │
    │ "21°C setzen" → INSERT thermostat_commands
    ▼
Supabase Cloud
    │
    │ Collector pollt pending commands
    ▼
Node.js Collector (lokal)
    │
    │ TuyAPI über LAN (Port 6668)
    ▼
Thermostat (192.168.188.xxx)
```

---

## TGP508 DPS-Mapping

| DPS | Bedeutung | Werte |
|-----|-----------|-------|
| 1 | Modus | 'auto', 'manual', 'off' |
| 2 | Zieltemperatur | x10 (210 = 21.0°C) |
| 3 | Aktuelle Temperatur | x10 |
| 4 | Heizstatus | true/false |

---

## Netzwerk-Anforderungen

- **Port 6668 (TCP)**: Muss für LAN-Kommunikation offen sein
- **Feste IPs**: Thermostate sollten DHCP-Reservierungen haben
- **Gleiches Netzwerk**: Collector muss im selben LAN wie Thermostate laufen

---

## Troubleshooting

### "Device nicht gefunden"
- IP-Adresse prüfen (Router DHCP-Liste)
- Thermostat neu starten
- `python -m tinytuya scan` ausführen

### "Connection refused"
- Port 6668 wird blockiert
- Firewall-Regeln prüfen
- Thermostat möglicherweise offline

### "Invalid key"
- Local Key ist falsch
- TinyTuya Wizard erneut ausführen
- Key hat genau 16 Zeichen?

### Fronius nicht erreichbar
- Teste im Browser: `http://DEINE-FRONIUS-IP/solar_api/v1/GetPowerFlowRealtimeData.fcgi`
- Bei Gen24 Wechselrichtern muss die API ggf. aktiviert werden

### Datenbank-Fehler
- Überprüfe deine Internetverbindung
- Die Supabase-Konfiguration prüfen

---

## Autostart unter Windows

### Option 1: Startup-Ordner

1. Erstelle eine Verknüpfung zu `smartfox-collector.exe` oder `start-collector.bat`
2. Drücke `Win+R` und gib `shell:startup` ein
3. Verschiebe die Verknüpfung in den geöffneten Ordner

### Option 2: Task Scheduler

1. Task Scheduler öffnen
2. Neue Aufgabe erstellen
3. Trigger: Bei Anmeldung
4. Aktion: `node.exe` mit Argument `C:\pfad\zu\collector-node\index.js`
5. Arbeitsverzeichnis: `C:\pfad\zu\collector-node`

---

## Logs

Der Collector gibt detaillierte Logs aus:

```
[Fronius] Grid=150W, PV=3500W, Verbrauch=2800W, Batterie=75%
[Tuya] Thermostate synchronisieren...
[Tuya] Zimmer Uli: 20.5°C -> 21.0°C (Heizen: Ja)
[Commands] 1 Befehle verarbeiten...
[Commands] Ausgeführt: Zimmer Uli -> set_temp=22
```

---

## Checkliste für Tuya-Aktivierung

- [ ] Local Keys mit TinyTuya Wizard extrahieren
- [ ] IP-Adressen aller 10 Thermostate notieren
- [ ] In `config.json` alle devices eintragen
- [ ] `tuya.enabled` auf `true` setzen
- [ ] `npm install` (für tuyapi Dependency)
- [ ] Collector neu starten
