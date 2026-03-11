
# ✅ Batterie-bewusstes Morgenverhalten + Fixes

## Änderungen

### 1. `isMorningWaitPeriod` um Batterie-SOC erweitert (`pv-automation/index.ts`)
- Neue Parameter: `batterySoc` und `targetBatterySoc`
- **Sonnentag + Batterie >= target_battery_soc** → sofort heizen (eco_temp), Batterie wird tagsüber nachgeladen
- **Sonnentag + Batterie < target_battery_soc** → auf PV warten (wie bisher)
- **Kein Sonnentag** → Grid-Fallback (wie bisher)

### 2. Nacht-Check in `apply-recommendations/index.ts`
- Lädt `night_start_time` und `night_end_time` aus `heating_settings`
- Nachts werden keine Empfehlungen angewendet → sofort return

### 3. Build-Error in `HeatingDashboard.tsx` gefixt
- `NodeJS.Timeout` → `ReturnType<typeof setInterval>` (Browser-kompatibel)
