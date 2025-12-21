# 🔌 Smartfox & Fronius Datensammler

Dieses Python-Script sammelt Energiedaten von deinem Smartfox Energy Manager und Fronius Wechselrichter und speichert sie in der Cloud-Datenbank. So kann die PWA von überall auf die Daten zugreifen.

## 📋 Voraussetzungen

- Python 3.10 oder neuer
- Netzwerkzugang zu Smartfox und Fronius (gleiches LAN)
- Internetzugang für Datenbank-Upload

## 🚀 Installation

### 1. Python installieren

#### Windows
1. Lade Python von [python.org](https://www.python.org/downloads/) herunter
2. **Wichtig:** Aktiviere bei der Installation "Add Python to PATH" ✅
3. Klicke auf "Install Now"

#### macOS
```bash
# Mit Homebrew (empfohlen)
brew install python

# Oder von python.org herunterladen
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv
```

### 2. Projekt einrichten

Öffne ein Terminal/Eingabeaufforderung und navigiere zum `local-collector` Ordner:

```bash
cd pfad/zu/local-collector
```

### 3. Virtuelle Umgebung erstellen (empfohlen)

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 4. Abhängigkeiten installieren

```bash
pip install -r requirements.txt
```

### 5. Konfiguration anpassen

Kopiere die Beispiel-Konfiguration:

```bash
# Windows
copy config.example.json config.json

# macOS/Linux
cp config.example.json config.json
```

Öffne `config.json` und passe die IP-Adressen an dein Netzwerk an:

```json
{
  "smartfox_ip": "192.168.188.45",    // IP deines Smartfox
  "fronius_ip": "192.168.188.64",     // IP deines Fronius
  "polling_interval": 30,              // Sekunden zwischen Messungen
  "supabase_url": "...",              // Bereits konfiguriert
  "supabase_key": "..."               // Bereits konfiguriert
}
```

**Tipp:** Die IP-Adressen findest du in deinem Router unter den verbundenen Geräten.

## ▶️ Script starten

```bash
# Mit aktivierter virtueller Umgebung
python collector.py
```

Du solltest folgende Ausgabe sehen:

```
==================================================
🔌 Smartfox & Fronius Datensammler
==================================================
📡 Smartfox IP: 192.168.188.45
🔋 Fronius IP:  192.168.188.64
⏱️  Intervall:   30 Sekunden
--------------------------------------------------
✅ Datenbank-Verbindung hergestellt

🔍 Teste Verbindungen...
✅ Smartfox OK - PV: 3500W, Netz: +1200W
✅ Fronius OK - Batterie: 75.0%
--------------------------------------------------
🚀 Starte Datensammlung... (Strg+C zum Beenden)

[2024-01-15 14:30:00] ✅ PV:  3500W | Netz:  +1200W | Verbr:  2300W | Batt:  75%
[2024-01-15 14:30:30] ✅ PV:  3450W | Netz:  +1150W | Verbr:  2300W | Batt:  76%
```

Mit **Strg+C** beendest du das Script.

## 🔄 Automatischer Start

### Windows (Task Scheduler)

1. Öffne den **Taskplaner** (Windows-Suche → "Aufgabenplanung")
2. Klicke auf **Aufgabe erstellen**
3. **Allgemein:**
   - Name: "Smartfox Datensammler"
   - "Unabhängig von der Benutzeranmeldung ausführen" ✅
4. **Trigger:**
   - Neu → "Beim Start"
5. **Aktionen:**
   - Neu → Programm starten
   - Programm: `C:\Pfad\zu\local-collector\venv\Scripts\python.exe`
   - Argumente: `collector.py`
   - Starten in: `C:\Pfad\zu\local-collector`

### Linux (Systemd Service)

Erstelle `/etc/systemd/system/smartfox-collector.service`:

```ini
[Unit]
Description=Smartfox & Fronius Datensammler
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/local-collector
ExecStart=/home/pi/local-collector/venv/bin/python collector.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Aktivieren und starten:

```bash
sudo systemctl enable smartfox-collector
sudo systemctl start smartfox-collector
sudo systemctl status smartfox-collector
```

### macOS (LaunchAgent)

Erstelle `~/Library/LaunchAgents/com.smartfox.collector.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.smartfox.collector</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/DEIN_USER/local-collector/venv/bin/python</string>
        <string>/Users/DEIN_USER/local-collector/collector.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/DEIN_USER/local-collector</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Aktivieren:

```bash
launchctl load ~/Library/LaunchAgents/com.smartfox.collector.plist
```

## 🔧 Fehlerbehebung

### "Smartfox nicht erreichbar"
- Prüfe die IP-Adresse in `config.json`
- Stelle sicher, dass dein PC im gleichen Netzwerk ist
- Teste im Browser: `http://192.168.188.45/all`

### "Fronius nicht erreichbar"
- Prüfe die IP-Adresse in `config.json`
- Teste im Browser: `http://192.168.188.64/solar_api/v1/GetPowerFlowRealtimeData.fcgi`

### "Datenbank-Verbindung fehlgeschlagen"
- Prüfe deine Internetverbindung
- Die Supabase-Credentials in `config.json` sind bereits korrekt vorausgefüllt

### Script startet nicht
- Ist die virtuelle Umgebung aktiviert? (`venv\Scripts\activate` bzw. `source venv/bin/activate`)
- Sind alle Dependencies installiert? (`pip install -r requirements.txt`)

## 📊 Daten in der PWA

Die gesammelten Daten werden automatisch in der PWA angezeigt:
- Öffne die App unter: https://e1db9897-1b63-4925-9f1e-d169d22f705a.lovableproject.com
- Die Daten aktualisieren sich in Echtzeit dank Realtime-Subscription

## 📝 Lizenz

Dieses Script ist Teil des Smartfox Energy Monitor Projekts.
