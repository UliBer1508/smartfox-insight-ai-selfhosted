

# Analyse: PV-Automation und Machine Learning Probleme

## Zusammenfassung der gefundenen Probleme

Es gibt **3 kritische Probleme**, warum die ML-basierte Heizungsoptimierung nicht funktioniert:

---

## Problem 1: PV-Prognose wird nicht aktualisiert

**Status:** KRITISCH

**Befund:**
- Die letzte PV-Prognose in der Datenbank ist vom **25. Januar 2026** (vor 12 Tagen!)
- Fuer heute (6. Februar 2026) gibt es **keine Prognose**
- In den Logs: `Prognose: 0 kWh` - die PV-Automation hat keine Vorhersage verfuegbar

**Ursache:**
Es gibt **keinen Cron-Job** fuer `fetch-pv-forecast`. Die aktuellen Cron-Jobs sind:
1. `pv-automation-check` - jede Minute
2. `apply-heating-recommendations` - alle 15 Minuten
3. `daily-solar-analysis` - taeglich um 20:00
4. `solar-heating-monitor` - alle 15 Minuten 06:00-20:00

**FEHLEND:** Ein taeglicher Job, der morgens die PV-Prognose abruft!

**Loesung:**
Neuen Cron-Job erstellen, der taeglich um 06:00 `fetch-pv-forecast` aufruft:
```sql
SELECT cron.schedule(
  'fetch-pv-forecast-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/fetch-pv-forecast',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Problem 2: AI/ML-Entscheidungen schlagen komplett fehl

**Status:** KRITISCH

**Befund aus den Logs:**
```text
Google AI error: 404 - models/gemini-1.5-flash is not found
Lovable AI error: 402 - Not enough credits
❌ Both AI providers failed
[PV-Automation] ML decision failed, using fallback
```

**Ursachen:**
1. **Google AI:** Das Modell `gemini-1.5-flash` ist veraltet und nicht mehr verfuegbar
2. **Lovable AI Gateway:** Kein Guthaben vorhanden (402 Payment Required)

**Aktuelle Modell-Konfiguration in `analyze-patterns/index.ts`:**
```typescript
// Zeile 84-86
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=...`
);
```

**Loesung:**
Das Google AI Modell auf ein aktuelles Modell aktualisieren:
- `gemini-2.5-flash` (oder `gemini-3-flash-preview`)

Und im Fallback zu Lovable AI das korrekte Modell-Format verwenden:
```typescript
// Zeile 163
model: 'google/gemini-2.5-flash'  // statt gemini-1.5-flash
```

---

## Problem 3: Fallback-Logik funktioniert, aber suboptimal

**Status:** MITTEL

**Befund:**
Da die ML-Entscheidungen fehlschlagen, greift die `pv-automation` auf die **Basis-Zeitschaltung** zurueck:
- Morgen-Aufwaermphase (08:00): Alle Raeume auf eco_temp setzen - funktioniert
- PV-Surplus-Logik: Aktiviert nur bei >500W Ueberschuss UND >1000W PV

**Aktuelles Verhalten ohne ML:**
- Keine intelligente Priorisierung der Raeume
- Keine Beruecksichtigung der PV-Prognose fuer vorausschauendes Heizen
- Keine Optimierung basierend auf Solargewinn-Historie

---

## Aktionsplan

### Schritt 1: PV-Prognose Cron-Job hinzufuegen

Neuen SQL-Befehl ausfuehren:
```sql
SELECT cron.schedule(
  'fetch-pv-forecast-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/fetch-pv-forecast',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cW1oZHBjaXhrZnN1ZHh1Z2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NjAxODQsImV4cCI6MjA4MTMzNjE4NH0.3WDZXuxGECexP_wjvmK5QTFvJakMW2-SLs7FRzxoFKI"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

### Schritt 2: AI-Modell aktualisieren

Datei: `supabase/functions/analyze-patterns/index.ts`

Aenderungen:
```typescript
// Zeile 84-86: Google AI URL aktualisieren
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_KEY}`,
  ...
);

// Zeile 163: Lovable AI Model aktualisieren
model: 'google/gemini-2.5-flash'
```

### Schritt 3: PV-Prognose sofort manuell abrufen

Nach den Aenderungen die `fetch-pv-forecast` Funktion einmal manuell aufrufen, um aktuelle Daten zu haben.

---

## Zusammenfassung der Aenderungen

| Komponente | Problem | Loesung |
|------------|---------|---------|
| `pv_forecasts` Tabelle | Keine aktuellen Daten (letzter Eintrag 25.01.) | Cron-Job fuer taeglichen Abruf |
| `analyze-patterns` Edge Function | Veraltetes Modell `gemini-1.5-flash` | Update auf `gemini-2.5-flash` |
| Lovable AI Gateway | Credit-Fehler (402) | Fallback-Modell aktualisieren |

## Erwartetes Ergebnis nach Korrektur

1. **PV-Prognose:** Taeglich um 06:00 werden 7-Tages-Vorhersagen abgerufen
2. **ML-Entscheidungen:** Google AI liefert intelligente Heizungsempfehlungen
3. **Optimierung:** Vorausschauendes Heizen basierend auf erwarteter PV-Produktion
   - Sonnentage: Suedseite morgens auf Solar-Passiv-Modus, aktives Heizen erst bei genuegend PV
   - Truebe Tage: Fruehes Aufheizen um Batterie vor dem Abend zu schonen

