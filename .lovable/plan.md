# WW-Reserve aus Heizbudget entfernen

## Problem
In `supabase/functions/pv-automation/index.ts` wird das Eco-Budget künstlich um bis zu 2800W reduziert, wenn `hotwater` in `consumer_priority` vor `heating` steht und das WW-Zeitfenster (10:00–16:00) aktiv ist — unabhängig davon, ob WW gerade tatsächlich läuft.

Das widerspricht der dokumentierten Architektur (`mem://hardware/energy-system-specifications`): **Warmwasser wird autonom von Smartfox gemanaged.** Sobald WW läuft, sinkt `gridExport` automatisch — eine zusätzliche Software-Reserve führt zu Doppelbuchung und blockiert Komfort-/Eco-Upgrades obwohl real Überschuss vorhanden ist (heute: 9,8 kW Export, trotzdem nur 7,1 kW Komfort-Budget weil 2800W „reserviert").

## Änderungen

### 1. `supabase/functions/pv-automation/index.ts`
- **Zeile ~1267–1268**: `hotwaterReserveW` hart auf `0` setzen mit Kommentar `// WW autonom von Smartfox gemanaged — keine Software-Reserve (siehe mem://hardware/energy-system-specifications)`.
- **Zeile ~1271–1272**: Log-Bedingung & Text anpassen, damit nur noch `carReserveW` erscheint.
- **Zeile ~1355–1358**: Im Eco-Budget-Block den `hotwaterReserveW`-Abzug entfernen, nur `carReserveW` bleibt.
- **Zeile ~1071–1075** (`hotwaterKwh` im Tages-Energiemodell für Pre-Heat-Boost): bleibt unverändert — das ist eine **Energie-Prognose** (kWh über den Tag), nicht eine Momentan-Leistungsreserve, und dient korrekt der Tagesplanung.
- **Zeile ~2610** (`superComfortAllowed`-Gate prüft `!hotwaterActive`): bleibt unverändert — das ist eine sinnvolle Sicherheit, kein Budget-Abzug.

### 2. `src/components/heating/HeatingSettingsForm.tsx`
- Bei `hotwater_*` Feldern Helper-Text ergänzen: *„Hinweis: Warmwasser wird von Smartfox autonom gesteuert. Diese Werte dienen nur der Tagesenergie-Prognose und beeinflussen das Momentan-Heizbudget nicht."*

### 3. Memory-Updates
- **Neu**: `mem://features/heating/hotwater-smartfox-autonomous` — explizite Regel: WW läuft autonom über Smartfox, `pv-automation` zieht KEINE WW-Momentan-Reserve vom Heizbudget ab. `consumer_priority`-Reihenfolge zwischen `hotwater` und `heating` ist für die Budgetberechnung irrelevant. WW-Verbrauch reduziert `gridExport` bereits physikalisch.
- **Update** `mem://arch/pv-automation-budget-logic-v2`: Abschnitt zu Consumer-Reserven präzisieren — nur `carReserve` zieht Momentan-Leistung ab; WW nicht.
- **Update** `mem://index.md` Core-Zeile: hinzufügen *„Warmwasser autonom via Smartfox — keine Software-Budget-Reserve."*

## Validierung nach Deploy
1. Logs prüfen: `[CONSUMER-PRIORITY]`-Zeile zeigt `Warmwasser=0W` oder erscheint nur noch wenn `carReserveW > 0`.
2. `comfortBudget` sollte bei 9,8 kW Export ≈ 9,8 kW betragen (nicht mehr 7,1 kW).
3. Mehr Räume erreichen Phase 2 (Komfort) sobald sie `eco_temp - 0.3` überschreiten.

## Constraints
- Keine DB-Migration.
- Tuya-Quota-Thema (208/200) bleibt separat — wird hier NICHT angefasst.
- `night_end_time`-Logik aus vorigem Plan bleibt unverändert wirksam.
