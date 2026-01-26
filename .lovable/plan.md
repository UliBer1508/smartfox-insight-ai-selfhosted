
# Lokale Thermostat-Steuerung mit TuyAPI - Implementierungsplan

## Zusammenfassung

Umstellung der Thermostat-Steuerung von der Tuya Cloud API auf direkte LAN-Kommunikation mittels TuyAPI im Node.js Collector. Diese Loesung ist kostenlos, unbegrenzt und unabhaengig von Tuya Cloud-Limits.

---

## Voraussetzungen (vor Implementierung zu erledigen)

### 1. Local Keys extrahieren

Die Local Keys sind 16-Zeichen AES-Schluessel fuer die verschluesselte LAN-Kommunikation.

**Schritt-fuer-Schritt Anleitung:**

```bash
# 1. Python und TinyTuya installieren
pip install tinytuya

# 2. Wizard starten
python -m tinytuya wizard

# Eingaben:
# - Access ID: [Tuya Developer Portal -> Cloud -> Project]
# - Access Secret: [Tuya Developer Portal -> Cloud -> Project]
# - Region: eu (Central Europe Data Center)
# - Device ID: [leer lassen fuer alle Geraete]
```

**Ergebnis:** `devices.json` mit allen Local Keys:

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

**Wichtig:** Wenn das aktuelle Tuya-Konto blockiert ist (Error 28841004), warte auf den monatlichen Quota-Reset oder erstelle ein neues Tuya Developer-Konto.

### 2. IP-Adressen der Thermostate ermitteln

```bash
# Option A: TinyTuya Scan (im lokalen Netzwerk ausfuehren)
python -m tinytuya scan

# Option B: Router DHCP-Liste pruefen
# Option C: Tuya Smart App -> Geraet -> Einstellungen -> Geraete-ID
```

### 3. Betroffene Raeume und Device IDs

| Raum | Device ID | IP (zu ermitteln) | Local Key (zu ermitteln) |
|------|-----------|-------------------|--------------------------|
| Zimmer Uli | bf2f469ec7aa367dbeeni9 | 192.168.188.??? | ??? |
| Bad Uli | bfc0f118b0ff402d0e6tq5 | 192.168.188.??? | ??? |
| Buero | bf82697f99c1a5ecbde1vi | 192.168.188.??? | ??? |
| Flur | bf6494a907ec6a539d9tuz | 192.168.188.??? | ??? |
| Kinder Bad | bfc97f2493e23d5df3dxux | 192.168.188.??? | ??? |
| Waschraum | bf6c3657157cac2cd7zulr | 192.168.188.??? | ??? |
| Wirtschaftsraum | bf2cb2dbf2db634a34ukat | 192.168.188.??? | ??? |
| Wohnzimmer | bf367d27c659476dda1bby | 192.168.188.??? | ??? |
| Zimmer Luca | bf4b206843d82adae6opwr | 192.168.188.??? | ??? |
| Zimmer Luis | bfe27fbf29b47ad197zpe4 | 192.168.188.??? | ??? |

---

## Architektur nach Implementierung

```text
+-------------------------------------------+
|           PWA (Browser)                   |
|  ThermostatCard -> "21C setzen"           |
|            |                              |
|            v                              |
|  INSERT INTO thermostat_commands          |
|  (room_id, command, value, status)        |
+-------------------------------------------+
                    |
                    v (Supabase Realtime)
+-------------------------------------------+
|           Supabase Cloud                  |
|  thermostat_commands Tabelle              |
|  rooms Tabelle (mit local_key, ip)        |
+-------------------------------------------+
                    |
                    v (Collector pollt)
+-------------------------------------------+
|     Node.js Collector (lokal)             |
|  processCommands() -> pending holen       |
|  TuyAPI.setTemperature()                  |
|            |                              |
|            v (TCP Port 6668, LAN)         |
|  Thermostat (192.168.188.xxx)             |
+-------------------------------------------+
```

---

## Implementierung

### Teil 1: Datenbank-Migration

**Neue Spalten in `rooms` Tabelle:**

```sql
-- Local Key und IP fuer LAN-Kommunikation
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS local_key TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS thermostat_local_ip TEXT;
```

**Neue Tabelle `thermostat_commands`:**

```sql
CREATE TABLE thermostat_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
    command TEXT NOT NULL,           -- 'set_temp', 'set_mode'
    value NUMERIC,                   -- Temperaturwert oder Modus
    status TEXT DEFAULT 'pending',   -- pending, executing, executed, failed
    error_message TEXT,              -- Fehlermeldung bei status=failed
    created_at TIMESTAMPTZ DEFAULT now(),
    executed_at TIMESTAMPTZ          -- Zeitpunkt der Ausfuehrung
);

-- RLS aktivieren
ALTER TABLE thermostat_commands ENABLE ROW LEVEL SECURITY;

-- Policy fuer authentifizierte Benutzer
CREATE POLICY "Authenticated users full access" ON thermostat_commands 
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime aktivieren fuer sofortige Updates in der PWA
ALTER PUBLICATION supabase_realtime ADD TABLE thermostat_commands;

-- Index fuer schnelle Abfrage ausstehender Befehle
CREATE INDEX idx_thermostat_commands_status ON thermostat_commands(status) 
  WHERE status = 'pending';
```

### Teil 2: Node.js Collector Erweiterung

**Datei: `local-collector/collector-node/package.json`**

Neue Dependency hinzufuegen:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.87.1",
    "tuyapi": "^7.5.1"
  }
}
```

**Datei: `local-collector/collector-node/config.json` (Beispiel)**

Erweiterte Konfiguration mit Thermostat-Daten:

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
        "room_id": "0492135f-b081-4f0a-b037-4683e38c6dc2",
        "device_id": "bf2f469ec7aa367dbeeni9",
        "local_key": "HIER_LOCAL_KEY_EINTRAGEN",
        "ip": "192.168.188.XXX"
      },
      {
        "name": "Bad Uli",
        "room_id": "3d1e138f-dcc3-40a0-9aa4-17e834039419",
        "device_id": "bfc0f118b0ff402d0e6tq5",
        "local_key": "HIER_LOCAL_KEY_EINTRAGEN",
        "ip": "192.168.188.XXX"
      }
    ]
  },
  "polling_interval_seconds": 30,
  "supabase": {
    "url": "https://tvqmhdpcixkfsudxughs.supabase.co",
    "anon_key": "eyJhbGciOi..."
  }
}
```

**Neue Datei: `local-collector/collector-node/tuya-thermostat.js`**

```javascript
const TuyAPI = require('tuyapi');

// TGP508 Thermostat DPS-Mapping (Data Point Schema)
const DPS = {
  MODE: '1',           // Modus: auto/manual/off
  TARGET_TEMP: '2',    // Zieltemperatur (x10, z.B. 210 = 21.0C)
  CURRENT_TEMP: '3',   // Aktuelle Temperatur (x10)
  HEATING: '4'         // Heizstatus: true/false
};

class ThermostatController {
  constructor() {
    this.devices = new Map();
    this.connectionRetries = new Map();
  }

  /**
   * Holt oder erstellt TuyAPI Device-Instanz
   */
  getDevice(deviceConfig) {
    const key = deviceConfig.device_id;
    
    if (!this.devices.has(key)) {
      const device = new TuyAPI({
        id: deviceConfig.device_id,
        key: deviceConfig.local_key,
        ip: deviceConfig.ip,
        version: '3.3',
        issueRefreshOnConnect: true
      });
      
      device.on('error', (error) => {
        console.error(`[TuyAPI] ${deviceConfig.name} Fehler:`, error.message);
      });
      
      this.devices.set(key, device);
    }
    
    return this.devices.get(key);
  }

  /**
   * Liest Status eines Thermostats
   */
  async getStatus(deviceConfig) {
    const device = this.getDevice(deviceConfig);
    
    try {
      await device.find();
      await device.connect();
      
      const status = await device.get({ schema: true });
      const dps = status.dps || {};
      
      await device.disconnect();
      
      return {
        success: true,
        current_temp: (dps[DPS.CURRENT_TEMP] || 0) / 10,
        target_temp: (dps[DPS.TARGET_TEMP] || 0) / 10,
        is_heating: dps[DPS.HEATING] === true,
        mode: dps[DPS.MODE] || 'unknown'
      };
    } catch (error) {
      console.error(`[TuyAPI] ${deviceConfig.name} Status-Fehler:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setzt Zieltemperatur eines Thermostats
   */
  async setTemperature(deviceConfig, temperature) {
    const device = this.getDevice(deviceConfig);
    
    try {
      await device.find();
      await device.connect();
      
      // Temperatur * 10 (TGP508 erwartet z.B. 210 fuer 21.0C)
      const tempValue = Math.round(temperature * 10);
      
      await device.set({
        dps: DPS.TARGET_TEMP,
        set: tempValue
      });
      
      await device.disconnect();
      
      console.log(`[TuyAPI] ${deviceConfig.name}: Temperatur auf ${temperature}C gesetzt`);
      return { success: true };
    } catch (error) {
      console.error(`[TuyAPI] ${deviceConfig.name} Set-Fehler:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Alle Verbindungen schliessen
   */
  async disconnectAll() {
    for (const [id, device] of this.devices) {
      try {
        await device.disconnect();
      } catch (e) {
        // Ignorieren
      }
    }
    this.devices.clear();
  }
}

module.exports = ThermostatController;
```

**Erweiterte Datei: `local-collector/collector-node/index.js`**

```javascript
#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ThermostatController = require('./tuya-thermostat');

// Load configuration
let config;
try {
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('config.json nicht gefunden!');
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Fehler beim Laden der Konfiguration:', error.message);
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anon_key);

// Initialize Thermostat Controller (wenn aktiviert)
const thermostatCtrl = config.tuya?.enabled 
  ? new ThermostatController() 
  : null;

let lastThermostatSync = 0;

// HTTP GET request helper
function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Fetch data from Fronius
async function fetchFroniusData() {
  try {
    const url = `http://${config.fronius.ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
    const data = await httpGet(url);
    
    const site = data?.Body?.Data?.Site || {};
    const inverters = data?.Body?.Data?.Inverters || {};
    
    let batterySoc = null;
    for (const key in inverters) {
      if (inverters[key].SOC !== undefined) {
        batterySoc = inverters[key].SOC;
        break;
      }
    }
    
    return {
      battery_soc: batterySoc,
      pv_power: site.P_PV || 0,
      grid_power: site.P_Grid || 0,
      load_power: Math.abs(site.P_Load || 0),
      battery_power: site.P_Akku !== undefined ? site.P_Akku : null
    };
  } catch (error) {
    console.error('Fronius Fehler:', error.message);
    return null;
  }
}

// Save energy reading to database
async function saveReading(froniusData) {
  if (!froniusData) return false;

  const reading = {
    timestamp: new Date().toISOString(),
    power_io: froniusData.grid_power,
    energy_in: 0,
    energy_out: 0,
    battery_soc: froniusData.battery_soc,
    pv_power: froniusData.pv_power,
    consumption: froniusData.load_power,
    battery_power: froniusData.battery_power
  };
  
  try {
    const { error } = await supabase.from('energy_readings').insert(reading);
    if (error) throw error;
    console.log(`[Fronius] Grid=${reading.power_io}W, PV=${reading.pv_power}W`);
    return true;
  } catch (error) {
    console.error('Datenbank Fehler:', error.message);
    return false;
  }
}

// Sync all thermostats and update database
async function syncThermostats() {
  if (!thermostatCtrl || !config.tuya?.devices?.length) return;
  
  console.log('[Tuya] Thermostate synchronisieren...');
  
  for (const deviceConfig of config.tuya.devices) {
    const status = await thermostatCtrl.getStatus(deviceConfig);
    
    if (status.success) {
      // Update room in database
      const { error } = await supabase.from('rooms').update({
        current_temp: status.current_temp,
        target_temp: status.target_temp,
        is_heating: status.is_heating,
        last_thermostat_sync: new Date().toISOString()
      }).eq('id', deviceConfig.room_id);
      
      if (!error) {
        console.log(`[Tuya] ${deviceConfig.name}: ${status.current_temp}C -> ${status.target_temp}C (Heizen: ${status.is_heating ? 'Ja' : 'Nein'})`);
      }
    } else {
      console.error(`[Tuya] ${deviceConfig.name}: ${status.error}`);
    }
  }
}

// Process pending commands from PWA
async function processCommands() {
  if (!thermostatCtrl || !config.tuya?.devices?.length) return;
  
  // Fetch pending commands
  const { data: commands, error } = await supabase
    .from('thermostat_commands')
    .select('*, rooms(tuya_device_id, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  
  if (error || !commands?.length) return;
  
  console.log(`[Tuya] ${commands.length} Befehle verarbeiten...`);
  
  for (const cmd of commands) {
    // Find device config by tuya_device_id
    const deviceConfig = config.tuya.devices.find(
      d => d.device_id === cmd.rooms?.tuya_device_id
    );
    
    if (!deviceConfig) {
      await supabase.from('thermostat_commands').update({
        status: 'failed',
        error_message: 'Device nicht in config.json konfiguriert',
        executed_at: new Date().toISOString()
      }).eq('id', cmd.id);
      continue;
    }
    
    // Mark as executing
    await supabase.from('thermostat_commands').update({
      status: 'executing'
    }).eq('id', cmd.id);
    
    let result = { success: false, error: 'Unknown command' };
    
    if (cmd.command === 'set_temp') {
      result = await thermostatCtrl.setTemperature(deviceConfig, cmd.value);
    }
    
    // Update command status
    await supabase.from('thermostat_commands').update({
      status: result.success ? 'executed' : 'failed',
      error_message: result.error || null,
      executed_at: new Date().toISOString()
    }).eq('id', cmd.id);
    
    if (result.success) {
      console.log(`[Tuya] Befehl ausgefuehrt: ${cmd.rooms?.name} -> ${cmd.value}C`);
    }
  }
}

// Main polling loop
async function poll() {
  const now = Date.now();
  
  // Fronius-Daten abrufen (jedes Mal)
  console.log(`\n${new Date().toLocaleTimeString()} - Polling...`);
  const froniusData = await fetchFroniusData();
  if (froniusData) {
    await saveReading(froniusData);
  }
  
  // Thermostat-Befehle verarbeiten (jedes Mal)
  await processCommands();
  
  // Thermostate synchronisieren (alle X Sekunden)
  const syncInterval = (config.tuya?.sync_interval_seconds || 60) * 1000;
  if (now - lastThermostatSync >= syncInterval) {
    await syncThermostats();
    lastThermostatSync = now;
  }
}

// Get polling interval from database
async function getPollingInterval() {
  try {
    const { data } = await supabase
      .from('data_retention_settings')
      .select('polling_interval_seconds')
      .limit(1)
      .single();
    return data?.polling_interval_seconds || config.polling_interval_seconds;
  } catch {
    return config.polling_interval_seconds;
  }
}

// Startup
async function main() {
  console.log('========================================');
  console.log('   Fronius + Tuya Collector v3.0       ');
  console.log('========================================');
  console.log(`Fronius: ${config.fronius.ip}`);
  if (config.tuya?.enabled) {
    console.log(`Tuya: ${config.tuya.devices?.length || 0} Thermostate konfiguriert`);
  }
  console.log('Druecke Strg+C zum Beenden');
  console.log('----------------------------------------');
  
  // Test database connection
  try {
    const { error } = await supabase.from('energy_readings').select('id').limit(1);
    if (error) throw error;
    console.log('Datenbank-Verbindung OK');
  } catch (error) {
    console.error('Datenbank-Verbindung fehlgeschlagen:', error.message);
    process.exit(1);
  }
  
  const pollingInterval = await getPollingInterval();
  console.log(`Polling-Intervall: ${pollingInterval} Sekunden`);
  
  // Initial poll
  await poll();
  
  // Start polling loop
  setInterval(poll, pollingInterval * 1000);
}

main().catch(console.error);
```

### Teil 3: Frontend Anpassung

**Datei: `src/hooks/useTuyaControl.ts`**

Aendern der `setTemperature` Funktion um Befehle in die Queue zu schreiben:

```typescript
const setTemperature = useCallback(async (
  deviceId: string, 
  temperature: number, 
  roomId?: string
): Promise<boolean> => {
  if (!roomId) {
    toast.error('Room ID fehlt');
    return false;
  }

  try {
    // Befehl in Command-Queue schreiben (statt Cloud API)
    const { error } = await supabase.from('thermostat_commands').insert({
      room_id: roomId,
      command: 'set_temp',
      value: temperature,
      status: 'pending'
    });

    if (error) throw error;

    // Manual override setzen (2 Stunden)
    const overrideUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await supabase.from('rooms').update({
      manual_override_until: overrideUntil
    }).eq('id', roomId);

    toast.success(`Temperatur auf ${temperature}C gesetzt`);
    return true;
  } catch (error) {
    console.error('Error setting temperature:', error);
    toast.error('Fehler beim Setzen der Temperatur');
    return false;
  }
}, []);
```

---

## Dateien-Uebersicht

| Datei | Aenderung | Beschreibung |
|-------|-----------|--------------|
| **Datenbank** | Migration | `local_key`, `thermostat_local_ip` Spalten + `thermostat_commands` Tabelle |
| `collector-node/package.json` | Erweitern | `tuyapi` Dependency |
| `collector-node/config.json` | Erweitern | Tuya-Geraete mit Local Keys und IPs |
| `collector-node/tuya-thermostat.js` | Neu | TuyAPI Wrapper fuer LAN-Kommunikation |
| `collector-node/index.js` | Erweitern | `syncThermostats()` + `processCommands()` |
| `src/hooks/useTuyaControl.ts` | Aendern | Queue statt Cloud API |

---

## Vorteile der lokalen Loesung

| Aspekt | Cloud API (aktuell) | Lokale Steuerung (neu) |
|--------|---------------------|------------------------|
| API-Limits | 500/Monat, blockiert | Unbegrenzt |
| Latenz | 200-500ms | 20-50ms |
| Kosten | Lizenz erforderlich | Keine |
| Offline-faehig | Nein | Ja (Collector + Thermostate) |
| Abhaengigkeit | Tuya Cloud Server | Nur lokales Netzwerk |

---

## Checkliste zur Implementierung

- [ ] Local Keys mit TinyTuya Wizard extrahieren
- [ ] IP-Adressen der 10 Thermostate notieren
- [ ] Datenbank-Migration ausfuehren
- [ ] `tuya-thermostat.js` erstellen
- [ ] `index.js` erweitern
- [ ] `package.json` um tuyapi erweitern
- [ ] `config.json` mit Thermostat-Daten fuellen
- [ ] `useTuyaControl.ts` auf Queue umstellen
- [ ] Collector neu starten und testen
- [ ] Edge Function `tuya-control` kann deaktiviert/entfernt werden (optional)

---

## Technische Details

### TGP508 DPS-Mapping

| DPS-ID | Bedeutung | Wertebereich |
|--------|-----------|--------------|
| 1 | Modus | 'auto', 'manual', 'off' |
| 2 | Zieltemperatur | 50-350 (x10, also 5.0-35.0C) |
| 3 | Aktuelle Temperatur | x10 |
| 4 | Heizstatus | true/false |

### Netzwerk-Anforderungen

- Port 6668 (TCP) muss im LAN offen sein
- Thermostate muessen feste IP-Adressen haben (DHCP-Reservierung empfohlen)
- Collector muss im gleichen Netzwerk wie die Thermostate laufen
