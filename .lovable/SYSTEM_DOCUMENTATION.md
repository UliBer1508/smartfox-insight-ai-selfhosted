# Energie-Management-System - Vollständige Dokumentation

> **🔴 WICHTIG FÜR DIE ENTWICKLUNG:** Diese Dokumentation enthält alle System-Details,
> Architektur-Entscheidungen und die Änderungshistorie. Bei jeder Änderung MUSS 
> das Changelog (Sektion 12) aktualisiert werden!

**Letzte Aktualisierung:** 12.01.2026  
**Version:** 2.2
**Projekt-ID:** tvqmhdpcixkfsudxughs

---

## 1. System-Architektur

### Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HARDWARE LAYER                                  │
├─────────────────┬─────────────────┬─────────────────────────────────────────┤
│  Smartfox       │  Fronius        │  Tuya Thermostate (TGP508)              │
│  Energy Manager │  Wechselrichter │  - Wohnzimmer, Schlafzimmer, etc.       │
│  /all Endpoint  │  Solar API      │  - temp_current, temp_set, switch       │
└────────┬────────┴────────┬────────┴─────────────────────────────────────────┘
         │                 │                              ▲
         ▼                 ▼                              │
┌─────────────────────────────────────────────┐          │
│         LOKALER COLLECTOR                    │          │
│  Python (collector.py) oder                  │          │
│  Node.js (collector-node/index.js)           │          │
│  - Polling alle 30 Sekunden                  │          │
│  - Berechnet Verbrauch, PV, Batterie         │          │
└────────────────────┬────────────────────────┘          │
                     │                                    │
                     ▼                                    │
┌─────────────────────────────────────────────────────────┴───────────────────┐
│                         SUPABASE CLOUD BACKEND                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  DATENBANK (PostgreSQL)                                                      │
│  ├── energy_readings      - Rohe Messwerte (30s Intervall)                  │
│  ├── hourly_aggregates    - Stündliche Zusammenfassungen                    │
│  ├── daily_patterns       - Tages-Statistiken                               │
│  ├── rooms                - Räume mit Thermostat-Status                     │
│  ├── room_heating_logs    - Heizungs-Events                                 │
│  ├── room_recommendations - PV-basierte Empfehlungen                        │
│  ├── pv_forecasts         - PV-Prognosen (forecast.solar)                   │
│  ├── heating_settings     - Globale Heizungseinstellungen                   │
│  ├── smartfox_settings    - Geräte-IP Konfiguration                         │
│  ├── data_retention_settings - Datenaufbewahrung                            │
│  └── detected_patterns    - Erkannte Verbrauchsmuster                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  EDGE FUNCTIONS                                                              │
│  ├── pv-automation        - PV-Überschuss Heizungssteuerung                 │
│  ├── tuya-control         - Tuya API Integration                            │
│  ├── fetch-pv-forecast    - PV-Prognose von forecast.solar                  │
│  ├── aggregate-energy-data- Daten-Aggregation & Cleanup                     │
│  ├── analyze-patterns     - Muster-Erkennung                                │
│  └── apply-recommendations- Empfehlungen auf Thermostate anwenden           │
├─────────────────────────────────────────────────────────────────────────────┤
│  REALTIME SUBSCRIPTIONS                                                      │
│  └── energy_readings      - Live-Updates an PWA                             │
└─────────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PWA FRONTEND                                       │
│  React + TypeScript + Vite + Tailwind CSS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  SEITEN                                                                      │
│  └── Index.tsx (4 Tabs: Dashboard, Einstellungen, Analyse, Heizung)         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ENERGIE-KOMPONENTEN                                                         │
│  ├── EnergyFlowDiagram    - Animiertes Energiefluss-Diagramm                │
│  ├── PowerStats           - PV-Leistung und Verbrauch                       │
│  ├── ConsumptionExplainer - Verbrauchs-Erklärungen                          │
│  ├── BatteryHistoryChart  - Batterie-SOC Verlauf                            │
│  ├── ConnectionStatus     - Collector-Verbindungsstatus                     │
│  └── EnergyChart          - Zeitreihen-Diagramm                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  HEIZUNGS-KOMPONENTEN                                                        │
│  ├── HeatingDashboard       - Übersicht aller Räume                          │
│  ├── DailyHeatingSchedule   - Tagesprogramm mit 4 Modi & Temperaturen        │
│  ├── LearningProgress       - Kompakter ML-Status (Collapsible)              │
│  ├── RoomManager            - Raum-Verwaltung                                │
│  ├── ThermostatCard         - Einzelner Thermostat                           │
│  ├── PvForecastCard         - PV-Prognose Anzeige                            │
│  └── RoomRecommendations    - Heiz-Empfehlungen                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  HEIZUNGS-MODI                                                               │
│  ├── Nacht      - 22:00-06:00, night_temp (17-18°C)                         │
│  ├── Eco        - Tagsüber Standard, eco_temp (19-20°C)                     │
│  ├── Komfort    - PV >= 500W, comfort_temp (21-22°C)                        │
│  └── Batterie   - SOC < 20%, erzwingt eco_temp                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  AUTOMATIK-SCHALTER (pro Raum)                                               │
│  ├── pv_auto_enabled      - Zeit-/Überschuss-basierte Schaltung (☀️)        │
│  └── automation_enabled   - ML-Empfehlungen aktiviert (🤖)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  PWA FEATURES                                                                │
│  ├── Offline-fähig (Service Worker)                                         │
│  ├── Installierbar (iOS, Android, Windows)                                  │
│  ├── Auto-Update Check (alle 5 Minuten)                                     │
│  └── Push-Benachrichtigungen (geplant)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Lokaler Collector

### 2.1 Python-Version (`local-collector/collector.py`)

**Voraussetzungen:**
- Python 3.10+
- Netzwerkzugriff auf Smartfox/Fronius
- Internetverbindung für Supabase

**Installation:**
```bash
cd local-collector
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp config.example.json config.json
# config.json bearbeiten
python collector.py
```

**Konfiguration (`config.json`):**
```json
{
  "smartfox_ip": "192.168.188.45",
  "fronius_ip": "192.168.188.64",
  "polling_interval": 30,
  "supabase_url": "https://tvqmhdpcixkfsudxughs.supabase.co",
  "supabase_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Funktionsweise:**
1. `fetch_smartfox(ip)` - Ruft `/all` Endpoint ab
   - Liefert: `power_in`, `power_out`, `PvPower[]`, `PvEnergy[]`, `outputs[]`
2. `fetch_fronius_data(ip)` - Ruft Solar API ab
   - Liefert: `P_Akku`, `SOC`, `P_Grid`, `P_PV`, `P_Load`
3. `save_reading()` - Speichert kombinierte Daten in `energy_readings`

### 2.2 Node.js-Version (`local-collector/collector-node/index.js`)

**Vorteile:**
- Kompilierbar zu `.exe` für Windows
- Kein Python erforderlich
- Dynamisches Polling-Intervall aus Datenbank

**Installation:**
```bash
cd local-collector/collector-node
npm install
node create-config.bat  # Interaktive Konfiguration
npm start
```

**Oder als .exe:**
```bash
npm run build
# dist/smartfox-collector.exe + config.json kopieren
```

**Aktuelle Implementierung (Fronius-Only):**
```javascript
async function fetchFroniusData() {
  const response = await httpGet(
    `http://${config.fronius.ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`
  );
  const site = response.Body.Data.Site;
  const inverters = response.Body.Data.Inverters;
  
  return {
    battery_soc: inverters['1']?.SOC || 0,
    pv_power: Math.abs(site.P_PV || 0),
    grid_power: site.P_Grid || 0,
    load_power: Math.abs(site.P_Load || 0),
    battery_power: site.P_Akku || 0,
  };
}
```

### 2.3 Gespeicherte Messwerte

| Feld | Beschreibung | Quelle |
|------|--------------|--------|
| `timestamp` | Zeitstempel der Messung | Collector |
| `power_io` | Netz-Leistung (+Bezug, -Einspeisung) | Fronius P_Grid |
| `energy_in` | Kumulierte Energie-Bezug (kWh) | Smartfox (0 wenn nur Fronius) |
| `energy_out` | Kumulierte Energie-Einspeisung (kWh) | Smartfox (0 wenn nur Fronius) |
| `battery_soc` | Batterie-Ladezustand (%) | Fronius SOC |
| `battery_power` | Batterie-Leistung (+Laden, -Entladen) | Fronius P_Akku |
| `pv_power` | PV-Erzeugung (W) | Fronius P_PV |
| `consumption` | Hausverbrauch (W) | Fronius P_Load |

---

## 3. Datenbank-Schema

### 3.1 energy_readings (Rohdaten)

```sql
CREATE TABLE energy_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  power_io NUMERIC NOT NULL,           -- Netz-Leistung
  energy_in NUMERIC NOT NULL,          -- Bezug kWh
  energy_out NUMERIC NOT NULL,         -- Einspeisung kWh
  battery_soc NUMERIC,                 -- Batterie %
  battery_power NUMERIC,               -- Batterie W
  pv_power NUMERIC,                    -- PV W
  consumption NUMERIC,                 -- Verbrauch W
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 rooms (Räume mit Thermostaten)

```sql
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  thermostat_type TEXT DEFAULT 'TGP508',
  orientation TEXT,                    -- 'nord', 'süd', 'ost', 'west'
  has_solar_gain BOOLEAN DEFAULT false,
  floor_area_m2 NUMERIC,
  comfort_temp NUMERIC DEFAULT 21,
  eco_temp NUMERIC DEFAULT 19,
  night_temp NUMERIC DEFAULT 17,
  priority INTEGER DEFAULT 2,
  heating_power_w NUMERIC,
  
  -- Tuya Integration
  tuya_device_id TEXT,
  thermostat_ip TEXT,
  current_temp NUMERIC,
  target_temp NUMERIC,
  is_heating BOOLEAN DEFAULT false,
  last_thermostat_sync TIMESTAMPTZ,
  
  -- PV-Automatik
  pv_auto_enabled BOOLEAN DEFAULT false,
  pv_auto_active BOOLEAN DEFAULT false,
  pv_auto_last_change TIMESTAMPTZ,
  
  -- Automatik-Steuerung
  automation_enabled BOOLEAN DEFAULT false,
  last_auto_change TIMESTAMPTZ,
  
  -- Verbrauchsanalyse
  estimated_kwh_per_degree NUMERIC,
  last_heating_duration_min INTEGER,
  avg_heating_cycles_per_day NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 heating_settings (Globale Einstellungen)

```sql
CREATE TABLE heating_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- PV-Anlage
  pv_capacity_kwp NUMERIC DEFAULT 15.8,
  battery_capacity_kwh NUMERIC DEFAULT 13.8,
  
  -- Batterie-Schwellwerte
  min_battery_soc NUMERIC DEFAULT 20,
  target_battery_soc NUMERIC DEFAULT 80,
  
  -- Temperaturen
  comfort_temp NUMERIC DEFAULT 21,
  eco_temp NUMERIC DEFAULT 19,
  night_temp NUMERIC DEFAULT 18,
  preheat_hours NUMERIC DEFAULT 2,
  
  -- Standort (für PV-Forecast)
  latitude NUMERIC DEFAULT 47.24983,
  longitude NUMERIC DEFAULT 12.25415,
  roof_azimuth INTEGER DEFAULT 0,
  roof_declination INTEGER DEFAULT 35,
  
  -- PV-Automatik Schwellwerte
  pv_surplus_threshold_on INTEGER DEFAULT 500,   -- Heizen EIN bei 500W+
  pv_surplus_threshold_off INTEGER DEFAULT 200,  -- Heizen AUS unter 200W
  min_switch_interval_min INTEGER DEFAULT 5,
  
  -- Fußbodenheizung
  floor_heating_response_hours NUMERIC DEFAULT 2,
  estrich_storage_enabled BOOLEAN DEFAULT true,
  
  -- E-Auto
  car_charging_enabled BOOLEAN DEFAULT false,
  car_min_charge_power_w INTEGER DEFAULT 1380,
  
  -- Warmwasser (Smartfox-gesteuert)
  hotwater_enabled BOOLEAN DEFAULT true,
  hotwater_power_w INTEGER DEFAULT 2800,
  hotwater_min_surplus_w INTEGER DEFAULT 1000,
  hotwater_schedule_start TEXT DEFAULT '10:00',
  hotwater_schedule_end TEXT DEFAULT '16:00',
  
  -- Verbraucher-Priorität
  consumer_priority TEXT DEFAULT 'battery,heating,car',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 pv_forecasts (PV-Prognosen)

```sql
CREATE TABLE pv_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  expected_kwh NUMERIC DEFAULT 0,
  hourly_watts JSONB DEFAULT '{}',     -- {"06:00": 100, "07:00": 500, ...}
  sunrise TIME,
  sunset TIME,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.5 data_retention_settings (Datenaufbewahrung)

```sql
CREATE TABLE data_retention_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polling_interval_seconds INTEGER DEFAULT 300,
  raw_data_retention_days INTEGER DEFAULT 7,
  hourly_retention_days INTEGER DEFAULT 90,
  auto_cleanup_enabled BOOLEAN DEFAULT true,
  last_cleanup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. Edge Functions

### 4.1 pv-automation

**Zweck:** Aktiviert/deaktiviert Heizung basierend auf PV-Überschuss

**Trigger:** Manuell oder via Cron-Job

**Logik:**
```
1. Lade letzte Energiemessung
2. Berechne PV-Überschuss = pv_power - consumption + battery_power
3. Prüfe: battery_soc >= min_battery_soc (z.B. 20%)
4. Für jeden Raum mit pv_auto_enabled = true:
   - Wenn Überschuss >= threshold_on (500W) UND nicht bereits aktiv:
     → Setze comfort_temp via Tuya
     → pv_auto_active = true
   - Wenn Überschuss < threshold_off (200W) UND aktiv:
     → Setze eco_temp via Tuya
     → pv_auto_active = false
   - Prüfe min_switch_interval_min zwischen Änderungen
5. Aktualisiere rooms-Tabelle mit neuem Status
```

### 4.2 tuya-control

**Zweck:** Kommunikation mit Tuya Cloud API

**Aktionen:**
- `list` - Alle Geräte abrufen
- `status` - Status eines Geräts abrufen
- `set-temp` - Temperatur setzen
- `sync` - Alle Thermostat-Status synchronisieren

**Secrets:**
- `TUYA_ACCESS_ID`
- `TUYA_ACCESS_SECRET`

**Tuya API-Signatur:**
```javascript
const stringToSign = [
  clientId,
  timestamp,
  signStr,
  'GET\n' + contentHash + '\n\n' + url
].join('');

const sign = crypto
  .createHmac('sha256', clientSecret)
  .update(stringToSign)
  .digest('hex')
  .toUpperCase();
```

### 4.3 fetch-pv-forecast

**Zweck:** Holt PV-Prognose von forecast.solar

**API-Aufruf:**
```
https://api.forecast.solar/estimate/{lat}/{lon}/{dec}/{az}/{kwp}
```

**Parameter aus heating_settings:**
- `latitude`, `longitude` - Standort
- `roof_declination` - Dachneigung (0-90°)
- `roof_azimuth` - Ausrichtung (-180 bis 180°, 0=Süd)
- `pv_capacity_kwp` - Anlagenleistung

**Speichert:**
- `expected_kwh` - Erwartete Tagesproduktion
- `hourly_watts` - Stündliche Prognose als JSON
- `sunrise`, `sunset` - Sonnenauf-/untergang

### 4.4 aggregate-energy-data

**Zweck:** Konsolidiert alte Daten, löscht Rohdaten

**Ablauf:**
1. Rohdaten älter als `raw_data_retention_days` (7 Tage):
   → Aggregiere zu `hourly_aggregates`
   → Lösche Rohdaten
2. Stündliche Daten älter als `hourly_retention_days` (90 Tage):
   → Aggregiere zu `daily_patterns`
   → Lösche stündliche Daten
3. Aktualisiere `last_cleanup_at`

### 4.5 analyze-patterns

**Zweck:** Erkennt Verbrauchsmuster mittels AI

**Funktionen:**
- Tägliche Lastspitzen identifizieren
- Wiederkehrende Muster erkennen
- Heizungsempfehlungen generieren

**Analyse-Modi mit Heizungstyp-Unterstützung:**
- `optimize_decision` - ML-basierte Entscheidungen mit Heizungstyp
- `room_heating_optimization` - Raumspezifische Optimierung mit Heizungstyp
- `heating_optimization` - 6-Perioden-Heizplan mit Heizungstyp
- `daily_pattern` - Tagesanalyse mit Heizungstyp-Info
- `weekly_comparison` - Wochenvergleich mit Heizungstyp-Info

**Heizungstyp-Erkennung:**
```typescript
const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
const heatingTypeLabels = {
  'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
  'heat_pump': 'Wärmepumpe',
  'water': 'Wasserbasierte Heizung'
};
// Bei direct_electric: "KEINE Wärmepumpen-Tipps!"
```

### 4.6 apply-recommendations

**Zweck:** Wendet berechnete Empfehlungen auf Thermostate an

**Ablauf:**
1. Lade aktuelle `room_recommendations` für heute
2. Prüfe aktuelle Zeit gegen Empfehlungs-Zeitfenster
3. Setze empfohlene Temperatur via Tuya
4. Logge Event in `room_heating_logs`

---

## 5. Frontend Hooks

### 5.1 useSmartfoxData

```typescript
// Lädt Energiedaten mit Realtime-Updates
const { currentReading, readings, isConnected, lastError, refresh } = useSmartfoxData();
```

- Lädt letzte 100 Messwerte
- Realtime-Subscription auf INSERT-Events
- Verbindungsstatus basierend auf letztem Timestamp

### 5.2 useHeatingSettings

```typescript
const { settings, saveSettings, isLoading } = useHeatingSettings();
```

- Lädt/speichert globale Heizungseinstellungen
- Alle Felder aus `heating_settings` Tabelle

### 5.3 useRooms

```typescript
const { 
  rooms, 
  isLoading, 
  loadRooms, 
  createRoom, 
  updateRoom, 
  deleteRoom,
  togglePvAuto,
  setTemperature 
} = useRooms();
```

- CRUD für Räume
- PV-Automatik toggeln
- Temperatur via Tuya setzen

### 5.4 usePvForecast

```typescript
const { 
  forecasts, 
  todayForecast, 
  tomorrowForecast, 
  fetchForecast, 
  isLoading 
} = usePvForecast();
```

- Lädt PV-Prognosen für die nächsten 7 Tage
- Ruft `fetch-pv-forecast` Edge Function auf

### 5.5 useConsumptionAnalysis

```typescript
const { 
  activeConsumers, 
  isHotwaterActive, 
  isHeatingActive,
  explanation 
} = useConsumptionAnalysis(currentReading, rooms, settings);
```

- Analysiert aktuelle Verbraucher
- Prüft Warmwasser-Zeitplan
- Erklärt hohen Verbrauch

### 5.6 useServiceWorkerUpdate

```typescript
const { 
  showUpdatePrompt, 
  updateApp, 
  dismissUpdate 
} = useServiceWorkerUpdate();
```

- Prüft alle 5 Minuten auf Updates
- Prüft bei App-Focus
- Zeigt Update-Banner

---

## 6. PWA-Konfiguration

### vite.config.ts

```typescript
VitePWA({
  registerType: 'prompt',
  includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-*.png'],
  manifest: {
    name: 'Energiemonitor',
    short_name: 'Energie',
    theme_color: '#0ea5e9',
    background_color: '#0f172a',
    display: 'standalone',
    start_url: '/',
  },
  workbox: {
    skipWaiting: true,          // Sofortige Aktivierung
    clientsClaim: true,         // Alle Tabs übernehmen
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*supabase\.co\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'supabase-cache',
          expiration: { maxEntries: 50, maxAgeSeconds: 300 }
        }
      }
    ]
  }
})
```

---

## 7. Secrets & Konfiguration

### Supabase Secrets (Edge Functions)

| Secret | Beschreibung |
|--------|--------------|
| `TUYA_ACCESS_ID` | Tuya IoT Cloud Access ID |
| `TUYA_ACCESS_SECRET` | Tuya IoT Cloud Secret |
| `SUPABASE_URL` | Automatisch gesetzt |
| `SUPABASE_SERVICE_ROLE_KEY` | Automatisch gesetzt |

### Lokaler Collector (config.json)

| Feld | Beschreibung | Beispiel |
|------|--------------|----------|
| `smartfox_ip` | IP des Smartfox Energy Manager | `192.168.188.45` |
| `fronius_ip` | IP des Fronius Wechselrichters | `192.168.188.64` |
| `polling_interval` | Abfrageintervall in Sekunden | `30` |
| `supabase_url` | Supabase Projekt-URL | `https://xxx.supabase.co` |
| `supabase_key` | Supabase Anon Key | `eyJ...` |

---

## 8. Hardware-Anforderungen

### Smartfox Energy Manager

**API-Endpoint:** `http://{ip}/all`

**Response-Format:**
```json
{
  "power_in": 1500,
  "power_out": 0,
  "energy_in": 12345.6,
  "energy_out": 9876.5,
  "PvPower": [3500, 0],
  "PvEnergy": [1234.5, 0],
  "outputs": [true, false, false, false]
}
```

### Fronius Wechselrichter

**API-Endpoint:** `http://{ip}/solar_api/v1/GetPowerFlowRealtimeData.fcg`

**Response-Format:**
```json
{
  "Body": {
    "Data": {
      "Site": {
        "P_Grid": -500,      // Negativ = Einspeisung
        "P_Load": 1200,      // Hausverbrauch
        "P_PV": 3500,        // PV-Erzeugung
        "P_Akku": 800        // Positiv = Laden
      },
      "Inverters": {
        "1": {
          "SOC": 75          // Batterie-Ladezustand %
        }
      }
    }
  }
}
```

### Tuya Thermostate (TGP508)

**Datenpunkte:**
| DP | Name | Beschreibung |
|----|------|--------------|
| 1 | switch | Thermostat Ein/Aus |
| 2 | temp_set | Ziel-Temperatur (×10) |
| 3 | temp_current | Aktuelle Temperatur (×10) |
| 4 | mode | Modus (manual, auto, eco) |
| 5 | work_state | Heizstatus (heating, idle) |

---

## 9. Typische Workflows

### Täglicher Betrieb

1. **Collector läuft kontinuierlich**
   - Speichert alle 30 Sekunden Messwerte
   - Prüft Polling-Intervall aus Datenbank

2. **PWA zeigt Echtzeit-Daten**
   - Realtime-Subscription auf `energy_readings`
   - Automatische UI-Updates

3. **PV-Automatik (manuell oder cron)**
   - Prüft PV-Überschuss
   - Aktiviert/deaktiviert Heizung nach Schwellwerten

4. **Nächtliche Aggregation**
   - `aggregate-energy-data` bereinigt alte Daten
   - Konsolidiert zu Stunden- und Tages-Aggregaten

### Heizungs-Optimierung

1. **PV-Forecast abrufen**
   - Täglich morgens von forecast.solar
   - Speichert stündliche Prognose

2. **Empfehlungen berechnen**
   - `analyze-patterns` analysiert Muster
   - Generiert optimale Heizperioden

3. **Empfehlungen anwenden**
   - `apply-recommendations` setzt Temperaturen
   - Loggt alle Änderungen

---

## 10. Troubleshooting

### Collector verbindet nicht

1. **Smartfox testen:** `curl http://SMARTFOX-IP/all`
2. **Fronius testen:** `curl http://FRONIUS-IP/solar_api/v1/GetPowerFlowRealtimeData.fcg`
3. **Supabase testen:** Ping-Test zur Supabase-URL

### Keine Daten in PWA

1. **Verbindungsstatus prüfen** (ConnectionStatus-Komponente)
2. **Collector-Logs prüfen**
3. **Supabase-Logs prüfen** (Edge Function Logs)

### PV-Automatik funktioniert nicht

1. **Schwellwerte prüfen** in `heating_settings`
2. **Batterie-SOC prüfen** (min 20%)
3. **Räume prüfen:** `pv_auto_enabled = true`?
4. **Tuya-Credentials prüfen**

### Update nicht sichtbar

1. **5 Minuten warten** oder App neu fokussieren
2. **Update-Banner prüfen** (oben in der App)
3. **Browser-Cache leeren** (Entwicklertools → Application → Storage → Clear)

---

## 11. Entwicklung

### Lokale Entwicklung

```bash
npm install
npm run dev
```

### Edge Functions testen

```bash
# In Supabase Dashboard oder via Lovable Cloud
supabase functions serve function-name
```

### Collector testen

```bash
cd local-collector/collector-node
npm start
```

---

## 12. Änderungshistorie (Changelog)

> **Bei jeder Änderung hier dokumentieren!**

### Januar 2026

#### 12.01.2026 - Heizungstyp-Konsistenz
- **analyze-patterns erweitert** - Alle 5 Analyse-Modi übergeben jetzt `heating_type` an die KI
- **Wärmepumpen-Tipps eliminiert** - Explizite Anweisung verhindert irrelevante Empfehlungen bei `direct_electric`
- **Default-Settings erweitert** - `heating_type`, `total_heating_power_w`, `night_cycling_enabled`, `avg_night_cycles_per_room`

#### 09.01.2026 - Sicherheitsimplementierung
- **RLS aktiviert** auf allen 10 Tabellen die zuvor keine RLS hatten
- **Alte Policies entfernt** (18 unsichere "Allow All" Policies)
- **Neue einheitliche Policies erstellt** für alle 18 Tabellen
- **Security-Findings dokumentiert** und als nicht-relevant markiert
- **System-Dokumentation erweitert** mit Sicherheitsmodell und Changelog

#### 09.01.2026 - Heizungsverbrauch-Korrektur
- **Mitternachtsberechnung korrigiert** in `useHeatingConsumption.ts`
- Heizzyklen die über Mitternacht laufen werden jetzt proportional aufgeteilt
- `energy_estimate_wh` und `duration_minutes` werden korrekt zum jeweiligen Tag zugeordnet

#### [Frühere Änderungen]
- PV-Automatik mit Schwellwerten implementiert
- Tuya-Integration für Thermostate (TGP508)
- PWA mit Offline-Support und Auto-Update
- Datenretention-System mit Aggregation
- Pattern-Analyse mit AI (Lovable AI)
- Lokaler Collector (Python und Node.js)

---

## 13. Sicherheitsmodell

### Authentifizierung

| Aspekt | Implementierung |
|--------|-----------------|
| Methode | Email/Passwort |
| Provider | Supabase Auth (via Lovable Cloud) |
| Auto-Confirm | Aktiviert für Email-Signups |
| Registrierung | Nur für Familienmitglieder (privat) |

### Row Level Security (RLS)

**Konzept:** Einfaches Single-Household-Modell

| Benutzertyp | Zugriff |
|-------------|---------|
| Unauthentifiziert | ❌ Kein Zugriff |
| Authentifiziert | ✅ Voller Zugriff auf alle Daten |
| Edge Functions (service_role) | ✅ Voller Zugriff (RLS umgangen) |

**Begründung für dieses einfache Modell:**
- Private Familien-App ohne externe Benutzer
- Keine öffentliche Registrierung möglich
- Alle Familienmitglieder sollen alle Energiedaten sehen und steuern können
- Kein Multi-Tenant-Szenario erforderlich

### RLS Policies (Stand: 09.01.2026)

Alle 18 Tabellen haben eine einheitliche Policy:

```sql
CREATE POLICY "Authenticated users full access"
ON public.<table_name>
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
```

**Betroffene Tabellen:**
1. `consumer_logs`
2. `daily_patterns`
3. `data_retention_settings`
4. `detected_patterns`
5. `energy_daily_costs`
6. `energy_readings`
7. `heating_recommendations`
8. `heating_settings`
9. `hourly_aggregates`
10. `learning_events`
11. `pv_forecasts`
12. `room_heating_logs`
13. `room_ml_features`
14. `room_recommendations`
15. `room_temperature_samples`
16. `rooms`
17. `smartfox_settings`
18. `weather_data`

### Ignorierte Security-Findings

| Finding | Kategorie | Begründung |
|---------|-----------|------------|
| GPS-Koordinaten in `heating_settings` | Location Exposure | Nur authentifizierte Familienmitglieder haben Zugriff; für PV-Forecast benötigt |
| `USING (true)` in allen Policies | Permissive Policy | Bewusste Entscheidung für Single-Household-System ohne Multi-Tenant-Anforderung |

---

## 14. Entscheidungsprotokoll

> Dokumentiert wichtige Architektur-Entscheidungen mit Begründung

| Entscheidung | Begründung | Datum |
|--------------|------------|-------|
| **Heizungstyp in KI-Prompts** | Verhindert irrelevante Wärmepumpen-Tipps; direkte elektrische Fußbodenheizung erfordert andere Optimierungsstrategien | 12.01.2026 |
| **Fronius-Only Collector** | Smartfox liefert keine zuverlässigen kumulierten Energiewerte; Fronius P_Grid/P_PV/P_Load sind genauer | 01/2026 |
| **Simple RLS statt User-ID-basiert** | Single-Household-App, keine Multi-Tenant-Anforderung, alle Familienmitglieder brauchen vollen Zugriff | 09.01.2026 |
| **PV-Automatik mit Hysterese** | Zwei Schwellwerte (on/off) verhindern häufiges Schalten bei schwankender Solarproduktion | Initial |
| **Lokaler Collector statt Cloud-Polling** | Smartfox/Fronius nur im LAN erreichbar, kein Cloud-Zugriff möglich | Initial |
| **PWA statt Native App** | Plattformübergreifend (iOS/Android/Windows), einfache Updates, keine App-Store-Zulassung nötig | Initial |
| **Tuya Cloud API statt lokale Steuerung** | TGP508 Thermostate haben keine lokale API, nur Tuya Cloud | Initial |
| **30-Sekunden Polling-Intervall** | Kompromiss zwischen Echtzeit-Gefühl und Datenvolumen | Initial |
| **Datenretention mit Aggregation** | Rohdaten 7 Tage, stündlich 90 Tage, täglich unbegrenzt - spart Speicherplatz | Initial |

---

## 15. Bekannte Einschränkungen

| Bereich | Einschränkung | Workaround |
|---------|---------------|------------|
| Smartfox-Daten | Keine zuverlässigen kumulierten kWh-Werte | Nur Fronius-Daten verwenden |
| Tuya-API | Rate-Limiting bei zu vielen Anfragen | Min. 5 Minuten zwischen Temperaturänderungen |
| PV-Forecast | forecast.solar Free-Tier: 12 Anfragen/Stunde | Nur einmal täglich abrufen |
| Offline-Modus | Nur Lesezugriff auf gecachte Daten | Thermostat-Steuerung benötigt Online |

---

## 16. Kontakt & Links

- **Lovable Cloud Projekt-ID:** `tvqmhdpcixkfsudxughs`
- **PV-Forecast API:** https://forecast.solar
- **Tuya IoT Platform:** https://iot.tuya.com
