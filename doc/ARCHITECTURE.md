# Architektur-Übersicht

Visuelle Darstellung der Systemarchitektur mit Mermaid-Diagrammen.

---

## Gesamtsystem

```mermaid
graph TB
    subgraph "Hardware Layer"
        SF[🦊 Smartfox Pro<br/>Energy Manager]
        FR[☀️ Fronius Inverter<br/>+ Batterie]
        TY[🌡️ Tuya Thermostats<br/>pro Raum]
    end
    
    subgraph "Collection Layer"
        COL[📡 Local Collector<br/>Node.js / Python]
    end
    
    subgraph "Cloud Backend"
        DB[(🗄️ PostgreSQL<br/>18 Tabellen)]
        EF[⚡ Edge Functions<br/>8 Funktionen]
        RT[🔴 Realtime<br/>Subscriptions]
    end
    
    subgraph "Frontend"
        PWA[📱 React PWA<br/>TypeScript]
    end
    
    SF -->|HTTP API| COL
    FR -->|HTTP API| COL
    COL -->|Insert| DB
    
    DB --> RT
    RT -->|Subscribe| PWA
    PWA -->|Query| DB
    PWA -->|Invoke| EF
    EF -->|Control| TY
    EF -->|Read/Write| DB
```

---

## Datenfluss: Energy Readings

```mermaid
sequenceDiagram
    participant HW as Hardware
    participant COL as Collector
    participant DB as Database
    participant PWA as Frontend
    
    loop Every 30s
        COL->>HW: Fetch Smartfox/Fronius
        HW-->>COL: Power, Battery, PV data
        COL->>DB: INSERT energy_readings
        DB-->>PWA: Realtime update
        PWA->>PWA: Update Charts
    end
```

---

## Heizungs-Automatik Ablauf

```mermaid
flowchart TD
    START[⏰ pv-automation<br/>Cron Trigger] --> FETCH[Aktuelle Daten laden]
    FETCH --> CHECK{PV-Überschuss<br/>vorhanden?}
    
    CHECK -->|Ja| ROOMS[Räume mit<br/>pv_auto_enabled laden]
    CHECK -->|Nein| REDUCE[Temperatur auf<br/>eco_temp reduzieren]
    
    ROOMS --> PRIO[Nach Priorität<br/>sortieren]
    PRIO --> LOOP[Für jeden Raum]
    
    LOOP --> SURPLUS{Überschuss ><br/>threshold_on?}
    SURPLUS -->|Ja| HEAT[Temperatur auf<br/>comfort_temp erhöhen]
    SURPLUS -->|Nein| SKIP[Raum überspringen]
    
    HEAT --> TUYA[tuya-control<br/>aufrufen]
    TUYA --> LOG[Learning Event<br/>speichern]
    
    REDUCE --> TUYA
    SKIP --> NEXT{Weitere<br/>Räume?}
    LOG --> NEXT
    NEXT -->|Ja| LOOP
    NEXT -->|Nein| END[✅ Fertig]
```

---

## Datenbank-Schema (vereinfacht)

```mermaid
erDiagram
    ENERGY_READINGS {
        uuid id PK
        timestamp timestamp
        float power_io
        float pv_power
        float battery_soc
        float consumption
    }
    
    ROOMS {
        uuid id PK
        string name
        float current_temp
        float target_temp
        boolean pv_auto_enabled
        string tuya_device_id
    }
    
    ROOM_HEATING_LOGS {
        uuid id PK
        uuid room_id FK
        string event_type
        float energy_estimate_wh
    }
    
    HEATING_SETTINGS {
        uuid id PK
        float comfort_temp
        float eco_temp
        float pv_surplus_threshold_on
    }
    
    PV_FORECASTS {
        uuid id PK
        date date
        float expected_kwh
        json hourly_watts
    }
    
    ROOMS ||--o{ ROOM_HEATING_LOGS : "hat"
    ROOMS ||--o{ ROOM_ML_FEATURES : "hat"
    ROOMS ||--o{ ROOM_RECOMMENDATIONS : "hat"
```

---

## Edge Functions Übersicht

```mermaid
graph LR
    subgraph "Automation"
        PVA[pv-automation]
        TC[tuya-control]
    end
    
    subgraph "Data Processing"
        AED[aggregate-energy-data]
        AP[analyze-patterns]
        MFE[ml-feature-extraction]
    end
    
    subgraph "External APIs"
        FPV[fetch-pv-forecast]
        FW[fetch-weather]
        ASG[analyze-solar-gain]
    end
    
    subgraph "Learning"
        ED[evaluate-decision]
        AR[apply-recommendations]
    end
    
    PVA --> TC
    PVA --> ED
    FPV --> PVA
    MFE --> AR
```

---

## Technologie-Stack

| Layer | Technologie | Zweck |
|-------|-------------|-------|
| Frontend | React 18 + TypeScript | UI-Framework |
| Styling | Tailwind CSS + shadcn/ui | Design System |
| State | TanStack Query | Server State |
| Charts | Recharts | Visualisierung |
| PWA | Vite PWA Plugin | Offline Support |
| Backend | Supabase Edge Functions | Serverless Logic |
| Database | PostgreSQL | Datenspeicherung |
| Realtime | Supabase Realtime | Live Updates |
| Auth | Supabase Auth | Authentifizierung |
| Hardware | Smartfox, Fronius, Tuya | Energie + Heizung |

---

## Ordnerstruktur

```
├── .lovable/              # Dokumentation
│   ├── SYSTEM_DOCUMENTATION.md
│   ├── CHANGELOG.md
│   ├── ARCHITECTURE.md
│   └── TODO.md
├── local-collector/       # Datensammler
│   ├── collector.py       # Python-Version
│   └── collector-node/    # Node.js-Version
├── src/
│   ├── components/
│   │   ├── energy/        # Energie-Dashboard
│   │   ├── heating/       # Heizungs-Steuerung
│   │   └── ui/            # shadcn Komponenten
│   ├── hooks/             # React Hooks
│   ├── pages/             # Routen
│   └── types/             # TypeScript Types
└── supabase/
    └── functions/         # Edge Functions
```
