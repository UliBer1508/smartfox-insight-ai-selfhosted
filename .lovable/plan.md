

# Batterie-bewusstes Morgenverhalten + Fixes

## Änderungen

### 1. `isMorningWaitPeriod` um Batterie-SOC erweitern (`pv-automation/index.ts`)

Neue Parameter: `batterySoc` und `targetBatterySoc`.

Logik:
- **Sonnentag erwartet + Batterie >= target_battery_soc** → `shouldWait: false` → sofort auf eco_temp heizen (Batterie trägt das, wird tagsüber wieder geladen)
- **Sonnentag erwartet + Batterie < target_battery_soc** → `shouldWait: true` → auf PV warten (wie bisher)
- **Kein Sonnentag** → `shouldWait: false` → Grid-Fallback (wie bisher)

Aufruf (Zeile 1031) wird um `batterySoc` und `settings.target_battery_soc` erweitert — beide Werte sind bereits im Scope.

### 2. Nacht-Check in `apply-recommendations/index.ts`

`night_start_time` und `night_end_time` aus `heating_settings` laden. Wenn Nachtzeit aktiv, sofort zurückkehren ohne Empfehlungen anzuwenden.

### 3. Build-Error in `HeatingDashboard.tsx` fixen

Zeile 103: `NodeJS.Timeout` → `ReturnType<typeof setInterval>`.

