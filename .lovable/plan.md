
# Plan: Sequenzielles PV-Heizen implementieren

## Problem-Analyse

### Aktuelle Situation (08:29 Uhr)
| Metrik | Wert |
|--------|------|
| PV-Leistung | 1.3 kW |
| Netzbezug | 2.8 kW |
| Verbrauch | 4.1 kW |
| Batterie SOC | 5% |
| Budget | 1044W |
| Thermostat-Ziel | 18C (alle Raume) |
| Raumtemperaturen | 18.3-19.8C |

### Root-Cause: Thermostate ignorieren Cloud-Befehle

Die TGP508 Thermostate haben **zwei Betriebsmodi**:
- `auto`: Folgt internem 6-Perioden-Programm (Hardware)
- `home`: Folgt Cloud/API-Befehlen

**Problem:** Die Thermostate laufen vermutlich im `auto`-Modus und ignorieren die 18C-Cloud-Befehle. Das interne Programm sagt "heize auf 20C" und ueberschreibt alles.

### Beweisfuehrung aus Logs
```
[PV-Automation] Buero deactivate: Setze 18C (targetTemp=18, nightTemp=18)
[Tuya] bf82... -> 18C: success=true
```
- API meldet Erfolg, ABER Thermostat heizt trotzdem (`is_heating = true`)
- Datenbank zeigt `heating_paused_reason: budget` - bedeutet System WILL pausieren, kann aber nicht

## Loesung: Modus-Umschaltung + Sequenzielles Heizen

### Schritt 1: Thermostat-Modus auf `home` setzen

Bevor Temperatur-Befehle funktionieren, muss der Modus umgeschaltet werden:

```typescript
// NEUER BEFEHL vor temp_set:
const modeCommands = [
  { code: 'mode', value: 'home' },  // Auf manuellen Modus umschalten
  { code: 'temp_set', value: tempValue }
];
```

### Schritt 2: Budget-basiertes sequenzielles Heizen

Die aktuelle Logik berechnet das Budget korrekt (1044W), aber aktiviert dann keinen Raum zum Heizen. Das muss geaendert werden:

**Aktuelle Logik:**
```
Budget: 1044W
- Kein Raum braucht Heizung (alle auf 18C, Temp bereits 18-19C)
- Ergebnis: Heizung aus
```

**Neue Logik:**
```
Budget: 1044W = 1 Raum a 1000W
1. Waehle Raum mit hoechster Prioritaet + niedrigster Temperatur
2. Setze NUR diesen Raum auf Comfort-Temp (21C)
3. Alle anderen Raeume auf 15C (Frostschutz)
4. Nach 30 Min: Rotation zum naechsten Raum
```

### Dateiaenderungen

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/pv-automation/index.ts` | 1. Modus-Umschaltung vor temp_set hinzufuegen 2. Sequenzielles Heizen mit Frostschutz fuer nicht-aktive Raeume |
| `supabase/functions/tuya-control/index.ts` | Modus-Befehl als Option hinzufuegen |

### Implementierungs-Details

#### 1. Neue Funktion: setDeviceModeAndTemperature

```typescript
async function setDeviceModeAndTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  mode: 'home' | 'auto',
  temperature: number
): Promise<TuyaResult> {
  const commands = [
    { code: 'mode', value: mode },
    { code: 'temp_set', value: Math.round(temperature * 10) }
  ];
  
  return await tuyaRequest(accessId, accessSecret, 
    'POST', `/v1.0/devices/${deviceId}/commands`, 
    { commands });
}
```

#### 2. Sequenzielles Heizen mit Frostschutz

```typescript
// Im Budget-Management Abschnitt:
const frostProtectionTemp = 15; // Minimum um Frostschaeden zu vermeiden

// Fuer jeden Raum:
if (roomBudgetStatus.get(room.id)?.allowedToHeat) {
  // Dieser Raum darf heizen -> Comfort-Temp
  targetTemp = comfortTemp;
  mode = 'home';
} else {
  // Raum wartet -> Frostschutz um autonomes Heizen zu verhindern
  targetTemp = frostProtectionTemp;
  mode = 'home';  // WICHTIG: Auch auf home setzen!
}
```

### Ablauf nach Implementierung

```
08:30 - PV: 1.3 kW, Budget: 1044W

Raum-Auswahl nach Prioritaet + Temp-Defizit:
1. Wohnzimmer (2.4 kW) - SKIP (uebersteigt Budget)
2. Buero (0.9 kW) - AKTIVIERT (passt in 1044W)
   -> Setze auf 21C, Modus: home
3. Alle anderen Raeume:
   -> Setze auf 15C, Modus: home

Ergebnis:
- Buero heizt mit 900W
- Alle anderen Thermostate auf 15C = heizen NICHT
- Netzbezug: ~100W (statt 2.8 kW!)
- PV-Ueberschuss wird genutzt

09:00 - Rotation:
- Buero -> 15C (Pause)
- Zimmer Luis (1 kW) -> 21C (naechster im Budget)
```

### Erwartetes Ergebnis

| Vorher | Nachher |
|--------|---------|
| 8 Raeume heizen autonom | 1 Raum heizt gezielt |
| 4.1 kW Verbrauch | ~1.3 kW Verbrauch |
| 2.8 kW Netzbezug | 0 W Netzbezug |
| Batterie wird entladen | Batterie bleibt stabil |

### Risiken und Mitigationen

1. **Frostgefahr bei 15C?**
   - 15C ist sicher, Frostschaeden erst unter 5C
   - Raeume kuehlen in 30 Min nur um ~0.5C ab (Fussbodenheizung = Traegheit)

2. **Nutzer-Komfort?**
   - Alle Raeume werden rotierend geheizt
   - Kein Raum bleibt laenger als ~2h unter Comfort

3. **API-Limit?**
   - Mehr Befehle (mode + temp) = doppelte API-Calls
   - Mitigation: Nur mode setzen wenn noch nicht auf 'home'
