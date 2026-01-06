# Collector auf Fronius-Only umstellen

## Uebersicht

Der Collector wird vereinfacht, da Smartfox nicht mehr verwendet wird. Alle Smartfox-bezogenen Funktionen werden entfernt und nur noch Fronius-Daten genutzt.

## Aenderungen

### Datei: `local-collector/collector-node/index.js`

**1. Smartfox-Funktion entfernen (Zeilen 48-78)**
- Die komplette `fetchSmartfoxData()` Funktion loeschen

**2. `saveReading()` vereinfachen (Zeilen 117-147)**
- Nur noch `froniusData` als Parameter
- Keine Fallback-Logik mehr zu Smartfox-Daten
- Direkte Verwendung der Fronius-Werte:

```javascript
async function saveReading(froniusData) {
  if (!froniusData) {
    console.log('⚠️ Keine Fronius-Daten zum Speichern');
    return false;
  }

  const reading = {
    timestamp: new Date().toISOString(),
    power_io: froniusData.grid_power,
    energy_in: 0,  // Fronius liefert keine kumulierten Energiewerte
    energy_out: 0,
    battery_soc: froniusData.battery_soc,
    pv_power: froniusData.pv_power,
    consumption: Math.abs(froniusData.load_power),
    battery_power: froniusData.battery_power
  };
  
  // ... rest bleibt gleich
}
```

**3. `poll()` Funktion vereinfachen (Zeilen 149-163)**
- Nur noch Fronius abrufen
- Keine parallele Abfrage mehr noetig:

```javascript
async function poll() {
  console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Fronius-Daten abrufen...`);
  
  const froniusData = await fetchFroniusData();
  
  if (froniusData) {
    await saveReading(froniusData);
  } else {
    console.log('⚠️ Keine Daten von Fronius erhalten');
  }
}
```

**4. `main()` anpassen (Zeilen 185-225)**
- Versionsname aendern zu "Fronius Collector v2.0"
- Smartfox-Status-Zeile entfernen
- Nur Fronius-IP anzeigen

**5. Fronius-Funktion korrigieren (Zeile 108)**
- `load_power` sollte positiv sein (Verbrauch ist immer positiv):

```javascript
load_power: Math.abs(site.P_Load || 0),  // Bereits korrekt
```

### Datei: `local-collector/collector-node/config.example.json`

Vereinfachte Konfiguration ohne Smartfox:

```json
{
  "fronius": {
    "ip": "192.168.1.101"
  },
  "polling_interval_seconds": 30,
  "supabase": {
    "url": "https://your-project.supabase.co",
    "anon_key": "your-anon-key"
  }
}
```

## Vorteile

1. **Einfacherer Code** - Weniger Komplexitaet, einfacher zu warten
2. **Keine Fallback-Fehler** - Keine falschen Werte durch Smartfox-Priorisierung
3. **Korrekte Consumption** - Direkt von Fronius P_Load, immer positiv
4. **Klarere Logs** - Nur Fronius-bezogene Meldungen

## Hinweis zu energy_in/energy_out

Fronius liefert keine kumulierten Energiezaehler (kWh). Diese Werte werden auf 0 gesetzt. Falls diese Werte benoetigt werden, muesste ein separater Smart Meter eingebunden werden.

## Kritische Dateien fuer Implementation

- `local-collector/collector-node/index.js` - Hauptaenderungen: Smartfox entfernen, saveReading vereinfachen
- `local-collector/collector-node/config.example.json` - Smartfox-Konfiguration entfernen
