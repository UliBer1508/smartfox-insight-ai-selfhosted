# Night-End-Time dynamisch machen

## Problem
Die UI zeigt `night_end_time = 08:00`, aber die Heizung startet weiterhin um 09:00, weil mehrere Stellen in `pv-automation/index.ts` hardcoded `wienHour === 9` bzw. Defaults `'06:00'`/`'09:00'` verwenden. Das Setting wird ignoriert.

## Ziel
Alle relevanten Logikgates lesen `settings.night_end_time` dynamisch. Das UI-Setting wird ab sofort wirksam — egal ob 06:00, 08:00 oder 09:00. Settings haben immer Vorrang vor hardcoded Werten.

## Änderungen

### 1. `supabase/functions/pv-automation/index.ts`
- Neue Helper am Dateianfang:
  - `parseTimeOfDay(s: string): { hour: number; minute: number }` — robustes Parsen von `HH:MM` / `HH:MM:SS`
  - `getDayStartHour(settings)` — Default `8` wenn nicht gesetzt
  - `getDayStartMinute(settings)` — Default `0`
- Alle Stellen mit `wienHour === 9` / `wienHour < 9` / `wienHour >= 9` ersetzen durch `wienHour === dayStartHour` etc. (betrifft u. a. Zeilen ~632, 859, 863, 1041, 1056, 1203, 1264)
- Pre-Heat-Fenster: `dayWindowStartHour = Math.max(getDayStartHour(settings) - Math.round(floorResponseHours), 6)`
- Inkonsistente Defaults `'06:00'` / `'09:00'` (z. B. Zeile 2154 `policyNightEnd`) auf `settings.night_end_time ?? '08:00'` vereinheitlichen
- Log-Texte „09:00" durch dynamische Formatierung ersetzen (z. B. `${String(dayStartHour).padStart(2,'0')}:${String(dayStartMin).padStart(2,'0')}`)

### 2. `src/hooks/useHeatingSettings.ts`
- `defaultSettings.night_end_time` von `'06:00'` auf `'08:00'` setzen (Konsistenz mit aktuellem DB-Wert).

### 3. Memory-Updates
- `mem://features/heating/night-and-day-logic-constraints` — Inhalt aktualisieren: Heizbeginn ist nicht mehr hartkodiert auf 09:00, sondern wird dynamisch aus `night_end_time` (Default 08:00) gelesen.
- `mem://index.md` Core-Zeile „Heating strictly starts at 09:00" → „Heating start time follows `night_end_time` setting (default 08:00)".

## Constraints
- Keine DB-Migration nötig (`night_end_time` existiert bereits).
- `night_start_time` bleibt unverändert (kein Auftrag).
- Nach Deploy: nächste pv-automation-Heartbeat-Runde (alle 2 min) übernimmt die neue Logik; um 08:00 startet der Eco-Plan.

## Validierung nach Umsetzung
1. Edge-Function `pv-automation` deployen.
2. Logs ab 08:00 prüfen: erwartete Meldung „Day start at 08:00" und Eco-Aktivierung.
3. DB-Check: `rooms.heating_paused_reason` wechselt von `night_frost_only` auf `null`, `target_temp` auf Eco-Werte.