
# Batterieschutz komplett entfernen

Der "Batterie-Schutz" Modus ist noch an zwei Stellen im Code aktiv, obwohl er laut fruherer Entscheidung entfernt werden sollte. Das Fronius-System verwaltet die Batterie eigenstandig -- wenn sie leer ist, wird einfach aus dem Netz geheizt.

## Betroffene Stellen

### 1. UI: DailyHeatingSchedule.tsx
- Entferne den Modus `battery_protect` aus dem `HeatingMode`-Typ
- Entferne die "Schutz / Batterie <20%" Anzeige-Box im Header
- Entferne die `battery_protect` Konfiguration aus `modeConfig`
- Entferne die `batterySoc`/`minBatterySoc` Parameter aus `getCurrentMode()`
- Die Funktion kennt dann nur noch 3 Modi: `night`, `eco`, `comfort`

### 2. Edge Function: pv-automation/index.ts (Zeile 1113-1118)
- Entferne den Block der bei `batterySoc < minBatterySoc` die Heizung auf `deactivate` setzt
- Die Heizung lauft dann unabhangig vom Batterie-SOC weiter (eco/comfort je nach PV)

### 3. Edge Function: analyze-patterns/index.ts (Zeile 493)
- Entferne die Prompt-Anweisung "Batterie <20% -> Keine Aktivierung, nur Frostschutz"

## Was sich andert

- Kein "Batterie-Schutz" Badge mehr im Dashboard (wie im Screenshot markiert)
- Die Tabelle zeigt nur noch 3 Spalten: Nacht, Eco, Komfort
- Heizung lauft auch bei leerem Akku normal weiter (uber Netzstrom)
- Fronius verwaltet das Batteriemanagement wie vorgesehen

## Technische Details

- `DailyHeatingSchedule.tsx`: HeatingMode-Typ auf `'night' | 'eco' | 'comfort'` reduzieren, `getCurrentMode` vereinfachen, Schutz-Box und modeConfig-Eintrag entfernen
- `pv-automation/index.ts`: Block Zeile 1113-1118 ("Battery protection") entfernen, der SOC-Check im Nachtmodus (Zeile 427-433) kann bleiben falls er anderweitig genutzt wird
- `analyze-patterns/index.ts`: Prompt-Zeile 493 entfernen/anpassen
