
# ✅ PV-Überschuss optimal nutzen: Stufenweise Heizung ohne Netzstrom

## Implementierte Änderungen

### 1. Budget auf gridExport basiert (`pv-automation/index.ts`)
- **VORHER**: `pvPower - baseLoad + tolerance` (geschätzte 500W Grundlast)
- **NACHHER**: `gridExport + tolerance` (tatsächlicher Netzexport)
- Verhindert Netzstromverbrauch für Heizung

### 2. 4-Stufen PV-Heizlogik (`pv-automation/index.ts`)
- **Stufe 1**: Raum < eco_temp → eco heizen (wenn `gridExport >= heatingPower`)
- **Stufe 2**: eco erreicht, Batterie ≥ 95%, kein WW → comfort heizen
- **Stufe 3**: ALLE Räume ≥ comfort, Export reicht → Prio-Raum +1°C (Super-Comfort)
- **Stufe 4**: Sonst → halten, kein Heizen
- Jede Stufe prüft `gridExport >= roomHeatingPower`

### 3. Warmwasser-Check (`pv-automation/index.ts`)
- Prüft `consumer_logs` auf aktives Warmwasser (`is_active=true, consumer_type='hotwater'`)
- Komfort/Super-Komfort nur wenn WW nicht aktiv

### 4. Temperatur-Deckelung (`pv-automation/index.ts`)
- Normal: comfort_temp ist Maximum
- Super-Comfort: comfort_temp + 1°C nur wenn alle Bedingungen erfüllt
- Batterie ≥ 95%, kein WW, alle Räume auf comfort, Export reicht
