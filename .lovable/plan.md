## Ziel
Die toten UI-Felder `min_battery_soc` und `target_battery_soc` aus den Heizungs-Einstellungen entfernen. Einziger funktionaler SOC-Schwellwert bleibt `heating_min_battery_soc` (default 80%).

## Änderungen

### 1. UI — `src/components/heating/HeatingSettingsForm.tsx`
- Felder „Min. SOC" und „Ziel SOC" aus der Karte „Anlage" entfernen.
- PV-/Batterie-Kapazität bleiben.
- `heating_min_battery_soc` bleibt unverändert in der Batterie-Sektion sichtbar.

### 2. Hook — `src/hooks/useHeatingSettings.ts`
- `min_battery_soc: 20` und `target_battery_soc: 80` aus `defaultSettings` entfernen.

### 3. Types — `src/types/heating.ts`
- `min_battery_soc` und `target_battery_soc` aus `HeatingSettings` entfernen (oder optional machen, falls anderswo noch referenziert — wird verifiziert).

### 4. Edge Function — `supabase/functions/pv-automation/index.ts`
- Tote Variable `const minBatterySoc = settings?.min_battery_soc ?? 20` (~Zeile 907) entfernen.
- Verbleibende Referenzen auf `target_battery_soc` per `rg` prüfen und entfernen.

### 5. AI-Prompts aufräumen
- `supabase/functions/analyze-patterns/index.ts`: `min_battery_soc` / `target_battery_soc` aus Prompt-Kontext entfernen.
- `supabase/functions/generate-settings-suggestions/index.ts`: aus Whitelist und Prompt entfernen, damit die KI diese Werte nicht mehr „optimiert".

### 6. DB
- **Keine Migration.** Spalten `heating_settings.min_battery_soc` / `target_battery_soc` bleiben in der DB (Defaults 20/80) — schaden nicht, vermeiden Migrationsrisiko.

### 7. Memory
- Neu: `mem://features/heating/soc-thresholds-consolidated.md` — nur `heating_min_battery_soc` ist wirksam, die anderen beiden sind deprecated DB-Reste.
- Update: `mem://config/heating-battery-threshold` — alte Aussage „target_battery_soc = 40% wirksam" korrigieren / als veraltet markieren.
- Update: `mem://index.md` Core — Zeile ergänzen: „SOC-Schwellwert für Heizung: ausschließlich `heating_min_battery_soc` (default 80%)."

## Nicht im Scope
- Keine DB-Migration.
- Keine Logik-Änderung am SOC-Gate (bleibt wie in `pv-automation-budget-logic-v2` dokumentiert).
- RoomManager unverändert.

## Betroffene Dateien
- `src/components/heating/HeatingSettingsForm.tsx`
- `src/hooks/useHeatingSettings.ts`
- `src/types/heating.ts`
- `supabase/functions/pv-automation/index.ts`
- `supabase/functions/analyze-patterns/index.ts`
- `supabase/functions/generate-settings-suggestions/index.ts`
- `.lovable/memory/features/heating/soc-thresholds-consolidated.md` (neu)
- `.lovable/memory/config/heating-battery-threshold.md` (Update)
- `.lovable/memory/index.md` (Update)
