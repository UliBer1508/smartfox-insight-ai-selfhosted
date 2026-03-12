
# ✅ Übertemperatur-Sicherheitsregel + Cooldown-Refactor

## Änderungen

### 1. Übertemperatur-Guard (`pv-automation/index.ts`)
- **VOR** Cooldown: Prüft ob `current_temp >= target_temp + 0.4°C` UND `is_heating=true`
- Erzwingt sofortigen FORCE-STOP → umgeht Cooldown komplett
- Setzt `heating_paused_reason: 'over_temp'`

### 2. Cooldown nur für Aufheiz-Aktionen (`pv-automation/index.ts`)
- Cooldown-Check verschoben: wird erst NACH Entscheidung angewendet
- `deactivate` und Temperatur-Reduktionen umgehen Cooldown IMMER
- Nur `activate` (Aufheizen) wird durch Cooldown verzögert

### 3. Skip-Logik erweitert (`pv-automation/index.ts`)
- Neues Kriterium `needsHeatingStop`: wenn `is_heating=true` aber Ist >= Ziel + 0.3°C
- In diesem Fall wird NIEMALS geskippt → Stop-Befehl wird immer gesendet

### 4. Pre-Sync vor jeder Automationsrunde (`pv-automation/index.ts`)
- Ruft `tuya-control/sync-all` auf bevor Entscheidungen getroffen werden
- Lädt danach frische Raumdaten aus der DB
- Bei Sync-Fehler: nur Sicherheits-Aktionen (Reduktionen/Stops), kein Aufheizen

### 5. Heizstatus-Hysterese (`tuya-control/index.ts`)
- `parseThermostatStatus` mit Deadband:
  - Ist >= Ziel + 0.3°C → `is_heating = false` (unabhängig von work_state)
  - Ist < Ziel - 0.2°C → `is_heating = true`
  - Dazwischen: `work_state` als Signal
- Verhindert "Heizt"-Anzeige wenn Temperatur bereits über Ziel
