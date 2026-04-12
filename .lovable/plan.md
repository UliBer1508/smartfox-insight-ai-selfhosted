

# Warum die KI frei erfundene Settings generiert

## Ursache

Zeile 271 der Edge Function:
```
setting_key: { type: "string", description: "Der Einstellungsschlüssel z.B. comfort_temp, night_temp, hotwater_schedule_start" }
```

Das ist ein **freier String** — die KI bekommt nur 3 Beispiele als Hinweis und erfindet den Rest. Gemini sieht die DB-Spalten nicht und generiert deutsche Bezeichnungen wie `soll_temp`, `heizleistung`, `min_pv_surplus`.

Zusätzlich fehlt im Frontend (`useSettingsSuggestions.ts`) jede Validierung — ein ungültiger Key wird direkt an Supabase geschickt, wo das Update stillschweigend scheitert.

## Lösung

### Änderung 1: Tool-Schema mit striktem Enum (Edge Function)

`supabase/functions/generate-settings-suggestions/index.ts`

`setting_key` von `type: "string"` auf `type: "string", enum: [...]` ändern, mit zwei getrennten Beschreibungen:

**Global (heating_settings):** `comfort_temp`, `eco_temp`, `night_temp`, `min_battery_soc`, `target_battery_soc`, `pv_surplus_threshold_on`, `pv_surplus_threshold_off`, `hotwater_min_surplus_w`, `hotwater_schedule_start`, `hotwater_schedule_end`, `hotwater_enabled`, `night_start_time`, `night_end_time`, `night_cycling_enabled`, `avg_night_cycles_per_room`, `pv_boost_temp_delta`, `night_heating_mode`, `estrich_storage_enabled`, `power_budget_enabled`, `max_grid_heating_power_w`

**Room (rooms, bei category=room_temp):** `comfort_temp`, `eco_temp`, `night_temp`, `pv_boost_max_temp`, `solar_limit_temp`

Im System-Prompt diese Listen zusätzlich als Text wiederholen, damit Gemini sie doppelt verankert hat.

### Änderung 2: Whitelist-Validierung im Frontend

`src/hooks/useSettingsSuggestions.ts`

- Zwei Whitelists definieren (global + room)
- Vor jedem DB-Update prüfen ob `setting_key` gültig ist
- Key-Mapping für häufige KI-Fehler: `soll_temp` → `target_temp`, `ziel_temp` → `target_temp`, `min_pv_surplus` → `hotwater_min_surplus_w`
- Bei ungültigem Key: Toast-Warnung und Vorschlag als fehlgeschlagen markieren

### Betroffene Dateien
1. `supabase/functions/generate-settings-suggestions/index.ts` — Enum im Tool-Schema + Prompt-Ergänzung
2. `src/hooks/useSettingsSuggestions.ts` — Whitelist + Mapping + Fehlerbehandlung

