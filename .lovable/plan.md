

## Plan: Eco-Tagesplanung mit PV-Prognose und Batterie-Abend-Reserve

### Problem
Die aktuelle Batterie-Korrektur blockiert Eco-Heizung, wenn momentan wenig PV da ist — auch wenn über den Tag verteilt genug Energie kommt. Die PV-Leistung ist über den Tag verteilt (morgens wenig, mittags viel). Batterie soll nur nach Sonnenuntergang für Eco genutzt werden, wenn Räume noch nicht auf Eco sind.

### Konzept

**Tagsüber (Sonne scheint):** Räume sequentiell mit aktuellem PV-Überschuss auf Eco heizen. Die Batterie-Korrektur bleibt aktiv — es wird nur geheizt was PV gerade liefert. Räume mit hoher Priorität zuerst, dann die nächsten wenn Budget frei wird.

**Nach Sonnenuntergang:** Wenn noch Räume unter Eco sind und Batterie-SOC > 50%, darf die Batterie zum Eco-Heizen verwendet werden. Die Batterie-Korrektur wird für Eco aufgehoben (nur für Eco, nicht für Komfort).

### Konkrete Änderungen in `supabase/functions/pv-automation/index.ts`

**1. Sonnenuntergang erkennen (~Zeile 870)**
- `sunset` aus `pv_forecasts` laden (bereits in Query vorhanden, aber nicht ausgelesen)
- Aktuelle Wien-Stunde mit Sunset vergleichen

**2. Eco-Energiebedarf berechnen (~neue Funktion, vor Zeile 945)**
- Pro Raum: `(ecoTemp - currentTemp) × heatingPower × geschätzteDauer`
- Summieren aller Räume die unter Eco sind
- Verbleibende PV-Energie aus `hourly_watts` ab aktueller Stunde bis Sunset berechnen
- Log ob PV-Tagesrest für alle Eco-Räume reicht

**3. Batterie-Korrektur differenzieren (~Zeile 957-972)**
```text
Wenn Sonne scheint (vor Sunset):
  → Batterie-Korrektur bleibt für ECO und KOMFORT aktiv
  → Heizen nur mit echtem PV-Überschuss
  
Wenn nach Sunset UND Räume noch unter Eco UND SOC > 50%:
  → Batterie-Korrektur für ECO aufheben (batteryDrain nicht abziehen)
  → Batterie-Korrektur für KOMFORT bleibt aktiv
  → Max. erlaubte Batterie-Entladung: SOC bis 50% (≈ 6.9 kWh nutzbar)
```

**4. Budget-Berechnung anpassen (~Zeile 945-985)**
- Neue Variable `afterSunset = currentHour >= sunsetHour`
- Neue Variable `ecoRoomsRemaining = Räume mit currentTemp < ecoTemp`
- Wenn `afterSunset && ecoRoomsRemaining > 0 && batterySoc > 50`:
  - `availableBudget` ohne Batterie-Abzug berechnen (wie vor dem Batterie-Fix)
  - Aber nur für `targetLevel: 'eco'` — Komfort bleibt strikt PV-only
- Logging: "Abend-Modus: Batterie-Reserve für X Eco-Räume freigegeben"

### Erwartetes Verhalten

```text
10:00 Uhr, PV 1400W, Batterie entlädt 500W:
→ Budget = 0 + 1300 - 500 = 800W → nur 1 Raum heizt
→ Nächster Raum kommt dran wenn erster fertig

14:00 Uhr, PV 6000W, Batterie lädt:
→ Budget = 3000W Export + 0 + 200 = 3200W → mehrere Räume parallel

19:30 Uhr (nach Sunset), 3 Räume noch unter Eco, SOC 75%:
→ Batterie-Reserve freigegeben (bis SOC 50%)
→ Budget = Batterie-Entladeleistung (~2000W) → Räume sequentiell auf Eco
→ Komfort wird NICHT aus Batterie gespeist
```

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen 870-985 (Forecast-Loading, Budget-Berechnung, Batterie-Korrektur)

