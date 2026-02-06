
# Plan: Verbesserte Verbraucheranzeige mit Raumspezifischen Heizungsdetails

## Problem-Analyse

Aktuelles Verhalten:
- `useConsumptionAnalysis` Hook lädt Räume basierend auf `is_heating` Flag aus der `rooms` Tabelle
- Problem: Das `is_heating` Flag wird nicht korrekt synchronisiert - es zeigt nur 1 Raum an, obwohl mehrere heizen
- Folge: Die Gesamtleistung ist falsch, die Benutzer sehen nicht alle aktiven Heizungen

Root-Cause:
- Das `is_heating` Flag ist abhängig von manueller Thermostat-Synchronisation
- Thermostate können heizen, ohne dass das Flag aktualisiert wird
- `room_heating_logs` mit `event_type = 'heating_start'` ist die **einzige zuverlässige Quelle** für aktive Heizungen

## Lösung: Intelligente Verbraucheranzeige

### 1. Neue Hook: `useActiveHeatingRooms` 
Ersetzt die fehlerhafte `is_heating`-Logik mit zuverlässigen Daten aus `room_heating_logs`:

```
useActiveHeatingRooms()
├─ Liest room_heating_logs (heute)
├─ Identifiziert Räume mit offenen heating_start Events
├─ Mappt zu rooms Tabelle für Metadaten
├─ Berechnet Leistung pro Raum
├─ Abonniert Echtzeit-Updates via Supabase Realtime
└─ Gibt zurück: { activeRooms[], totalPower, isLoading }
```

### 2. Verbesserte ConsumptionExplainer-Komponente
```
Struktur:
├─ Heizungen (aus activeHeatingRooms) - mit Raumliste
│  ├─ Zimmer Uli: 1.2 kW
│  ├─ Wohnzimmer: 2.4 kW
│  ├─ Büro: 0.9 kW
│  └─ Gesamt Heizung: 4.5 kW
├─ Warmwasser: ~2.3 kW (geschätzt)
└─ Sonstiges: 0.2 kW
```

**Raumdetails expandierbar/kollapsierbar**

### 3. Datenfluss-Änderungen

**Vorher:**
```
ConsumptionExplainer
  → useConsumptionAnalysis
    → rooms WHERE is_heating = true  ❌ Unzuverlässig
```

**Nachher:**
```
ConsumptionExplainer
  → useConsumptionAnalysis
    → useActiveHeatingRooms  ✅ Zuverlässig
      → room_heating_logs (heute) + Realtime
      → rooms (für Metadaten)
```

## Technische Umsetzung

### Dateien die geändert werden

| Datei | Aenderung |
|-------|-----------|
| `src/hooks/useActiveHeatingRooms.ts` | **NEU** - Hook zur Identifikation aktiver Heizungen basierend auf room_heating_logs |
| `src/hooks/useConsumptionAnalysis.ts` | Ändere Logik um `useActiveHeatingRooms` zu verwenden statt `is_heating` Flag |
| `src/components/energy/ConsumptionExplainer.tsx` | Erweitere UI um Raumdetails mit Dropdown-Struktur |

### Implementation Details

#### 1. `useActiveHeatingRooms.ts` (NEU)
- Query `room_heating_logs` ab heute Mitternacht
- Filter Events: `heating_start` ohne nachfolgendes `heating_stop`
- Berechne running duration: `(now - last_heating_start) / 60000`
- Join mit `rooms` Tabelle für Name, `heating_power_w`, Thermostat-Typ
- Subscribe zu Realtime Updates auf `room_heating_logs`
- Return: `{ activeRoomDetails[], totalHeatingPower, isLoading }`

**Schneller als vorher, da:**
- Query nur den heutigen Tag (indexed auf timestamp)
- Direkt die Wahrheit aus Event-Logs lesen
- Nicht auf fehlerhafte Flags verlassen

#### 2. `useConsumptionAnalysis.ts` (ÄNDERN)
```typescript
// ALT:
const [activeRooms, setActiveRooms] = useState<Room[]>([]);
const roomsResult = await supabase.from('rooms').select('*').eq('is_heating', true);

// NEU:
const { activeRooms } = useActiveHeatingRooms();
// Direkt verwenden, keine zusätzliche Query nötig
```

Logik bleibt gleich:
- Heizungen addieren
- Warmwasser als Differenz
- Sonstiges als Differenz

#### 3. `ConsumptionExplainer.tsx` (ERWEITERN)
```
Neuer State:
- expandedConsumer: string | null (welcher Consumer ist expandiert)

Rendering:
- Wenn activeConsumers[0].type === 'heating' UND .details?.rooms existiert
  → Zeige Expand-Button
  → Wenn expandiert: Liste alle Räume mit individueller Leistung
```

### Daten-Struktur

**Aktuell (ActiveConsumer):**
```typescript
interface ActiveConsumer {
  name: string;        // "Zimmer Uli"
  icon: LucideIcon;    // Flame
  power: number;       // 1200
  reason: string;      // "Heizung aktiv"
  color: string;       // "#F97316"
}
```

**Erweitert (mit Details für Heizungen):**
```typescript
interface ActiveConsumer {
  name: string;
  icon: LucideIcon;
  power: number;
  reason: string;
  color: string;
  details?: {           // NEU - nur für Heizungen
    rooms: {
      room_id: string;
      room_name: string;
      power: number;
      duration_min: number;
    }[];
  };
}
```

## Erwartetes Ergebnis

**Vorher:**
```
Aktive Verbraucher
🔥 Zimmer Uli    1.2 kW
💧 Warmwasser    ~5.6 kW (FALSCH - ist eigentlich andere Räume)
```

**Nachher:**
```
Aktive Verbraucher
🔥 Heizung       6.8 kW  [▼ Expand]
  ├─ Zimmer Uli    1.2 kW
  ├─ Wohnzimmer    2.4 kW
  ├─ Büro          0.9 kW
  ├─ Kinder Bad    0.5 kW
  └─ ...weitere
💧 Warmwasser    0.0 kW
```

## Edge Cases & Tests

✅ Keine aktiven Heizungen → Zeige "Keine"
✅ 1 aktive Heizung → Kein Expand-Button (nur Icon + Wert)
✅ Mehrere aktive Heizungen → Expand-Button mit Liste
✅ Realtime Updates → Neuer Raum startet zu heizen → UI aktualisiert sofort
✅ Browser-Sync: Neuladen sollte korrekte Werte zeigen

