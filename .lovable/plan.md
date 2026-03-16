
# ✅ PV-Überschuss optimal nutzen: Stufenweise Heizung ohne Netzstrom

## Implementierte Änderungen

### 1. Budget auf gridExport basiert (`pv-automation/index.ts`)
- **VORHER**: `pvPower - baseLoad + tolerance` (geschätzte 500W Grundlast)
- **NACHHER**: `gridExport + tolerance` (tatsächlicher Netzexport)
- Verhindert Netzstromverbrauch für Heizung

### 2. 4-Stufen PV-Heizlogik (`pv-automation/index.ts`)
- **Stufe 1**: Raum < eco_temp → eco heizen (wenn `gridExport >= heatingPower`)
- **Stufe 2**: eco erreicht, Batterie ≥ 95%, Export reicht (auch bei WW wenn genug Export) → comfort heizen
- **Stufe 3**: ALLE Räume ≥ comfort, Export reicht → Prio-Raum +1°C (Super-Comfort)
- **Stufe 4**: Sonst → halten, kein Heizen
- Jede Stufe prüft `gridExport >= roomHeatingPower`

### 3. Warmwasser-Check (`pv-automation/index.ts`)
- Prüft `consumer_logs` auf aktives Warmwasser (`is_active=true, consumer_type='hotwater'`)
- **NEU**: Komfort/Super-Komfort wird nur blockiert wenn `gridExport < roomHeatingPower + hotwaterPower`
- Bei genug Export wird parallel zu Warmwasser geheizt

### 4. Temperatur-Deckelung (`pv-automation/index.ts`)
- Normal: comfort_temp ist Maximum
- Super-Comfort: comfort_temp + 1°C nur wenn alle Bedingungen erfüllt
- Batterie ≥ 95%, kein WW, alle Räume auf comfort, Export reicht

### 5. Dynamische Budget-Toleranz (`pv-automation/index.ts`)
- **VORHER**: Feste Toleranz von 200W
- **NACHHER**: 20% des gridExport (mindestens 200W)
- Bei 8.871W Export → 1.774W Toleranz → Budget 10.645W → alle Räume können gleichzeitig heizen
