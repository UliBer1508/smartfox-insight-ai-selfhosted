
# Plan: PV-Prognose Reparatur

## Identifizierte Probleme

### Problem 1: Edge Function nicht deployed
Die `fetch-pv-forecast` Edge Function existiert im Code, ist aber **nicht auf der Cloud deployed**:
- Direkter Aufruf ergibt: `404 NOT_FOUND - Requested function was not found`
- Der Refresh-Button im Dashboard ruft diese Funktion auf und scheitert

### Problem 2: Sunrise/Sunset-Zeiten fehlen
Die Sunrise/Sunset-Zeiten in der Datenbank sind alle `NULL`:
- Die Forecast.Solar **kostenlose API** liefert diese Werte nur im **kostenpflichtigen Plan**
- Die aktuelle Implementierung versucht `message.info.sunrise/sunset` zu lesen, aber das Feld existiert nicht

### Problem 3: Veraltete Prognose-Daten
Die letzte Prognose in der Datenbank ist vom 06.02 (Anzeige) / 09.01 (tatsaechliche Daten):
- Der taegliche Cron-Job (06:00) funktioniert nicht, weil die Funktion nicht deployed ist
- Das Frontend zeigt Daten aus dem Cache, aber sie sind nicht aktuell

## Loesung

### Schritt 1: Edge Function deployen
```
Deploy: fetch-pv-forecast
```

### Schritt 2: Sunrise/Sunset aus anderen Quellen holen
Da die kostenlose Forecast.Solar API keine Sunrise/Sunset liefert, nutze ich die **bereits vorhandene Open-Meteo Wetterdaten** oder berechne Sunrise/Sunset basierend auf den PV-Daten selbst:

**Loesung A (empfohlen)**: Sunrise/Sunset aus den hourly_watts Daten extrahieren
- Die erste Stunde mit > 0 Watt = Sunrise-Zeit
- Die letzte Stunde mit > 0 Watt = Sunset-Zeit
- Diese Information ist bereits in den Daten vorhanden!

**Beispiel aus Datenbank:**
```
2026-01-09 07:56:05 → 0W (vor Sonnenaufgang)
2026-01-09 08:00:00 → 420W (nach Sonnenaufgang)
→ Sunrise ca. 07:56
```

### Schritt 3: Edge Function Code anpassen
```typescript
// Sunrise/Sunset aus hourly_watts extrahieren
function extractSunTimes(hourlyWatts: Record<string, number>): { sunrise: string, sunset: string } {
  const sorted = Object.entries(hourlyWatts)
    .sort((a, b) => a[0].localeCompare(b[0]));
  
  // Erste Zeit mit Watt > 0 = Sunrise
  const sunriseEntry = sorted.find(([_, w]) => w > 0);
  // Letzte Zeit mit Watt > 0 = Sunset
  const sunsetEntry = [...sorted].reverse().find(([_, w]) => w > 0);
  
  return {
    sunrise: sunriseEntry ? sunriseEntry[0].split(' ')[1].substring(0, 5) : null,
    sunset: sunsetEntry ? sunsetEntry[0].split(' ')[1].substring(0, 5) : null
  };
}
```

## Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/fetch-pv-forecast/index.ts` | Sunrise/Sunset aus hourly_watts ableiten statt aus API-Response |

## Deployments

1. `fetch-pv-forecast` Edge Function deployen
2. Funktion testen um sicherzustellen, dass neue Prognosen abgerufen werden

## Erwartetes Ergebnis

Nach Implementierung:
- Refresh-Button funktioniert (keine 404-Fehler mehr)
- Sunrise/Sunset-Zeiten werden korrekt angezeigt (z.B. 07:56 / 16:40)
- Aktuelle 7-Tage-Prognose wird geladen und angezeigt
- Taeglicher Cron-Job um 06:00 funktioniert wieder

## Ablauf

```
┌─────────────────────────────────────────────────────────┐
│  1. Edge Function deployen                              │
│     └── fetch-pv-forecast                               │
├─────────────────────────────────────────────────────────┤
│  2. Code anpassen                                       │
│     └── Sunrise/Sunset aus hourly_watts berechnen       │
├─────────────────────────────────────────────────────────┤
│  3. Erneut deployen + testen                            │
│     └── curl POST /fetch-pv-forecast                    │
├─────────────────────────────────────────────────────────┤
│  4. Pruefen ob Daten in DB korrekt sind                 │
│     └── SELECT * FROM pv_forecasts                      │
└─────────────────────────────────────────────────────────┘
```
