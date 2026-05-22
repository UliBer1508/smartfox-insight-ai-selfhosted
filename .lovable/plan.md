# Cleanup: Manuelle Empfehlungs-Buttons entfernen

Da `pv-automation` die alleinige Setpoint-Autorität ist und der KI-Autopilot (`ai_auto_mode_enabled` + `ai-parameter-advisor` Cron alle 15min) Parameter automatisch anwendet, sind die manuellen Buttons "Raumempfehlungen erstellen" und "Empfehlungen anwenden" funktionslos bzw. konfliktanfällig.

## Was entfernt wird

### 1. UI – `src/pages/Index.tsx`
- Tab "Raumweise" Buttons "Raumempfehlungen erstellen" + "Empfehlungen anwenden" (Zeilen ~412–462).
- Zugehörige States/Handler: `isAnalyzingRooms`, `roomStrategy`, `handleAnalyzeRooms`, `applyRecommendations`/`isApplying` aus `useAutomation`, `saveRoomRecommendations`/`loadRoomRecommendations` aus dem Recommendations-Hook.
- Komponente `<RoomRecommendations>` aus dem Index entfernen (zeigt nur veraltete manuell erzeugte Vorschläge).
- Tab "Raumweise" wird zu einem reinen Hinweis-Tab oder fällt komplett weg (Tabs: TGP508 Global, ML-Status bleiben).

### 2. UI – `src/components/heating/HeatingDashboard.tsx`
- Toten Code räumen: `applyRecommendations` aus `useAutomation`-Destructure, `isAnalyzingRooms`-State, `handleAnalyzeRooms`-Funktion, `saveRoomRecommendations`/`loadRoomRecommendations`, Import `RoomRecommendations`.
- Sichtbare Buttons "Alle pushen" + "Sync" bleiben unverändert.

### 3. Hook – `src/hooks/useAutomation.ts`
- Komplett entfernen, da nur `apply-recommendations` aufgerufen wird (toggle/apply/status). Keine anderen Konsumenten nach den UI-Cleanups.

### 4. Komponente – `src/components/heating/RoomRecommendations.tsx`
- Datei löschen (nur an o. g. zwei Stellen importiert).

### 5. Edge Function – `apply-recommendations`
- Verzeichnis `supabase/functions/apply-recommendations/` löschen.
- `supabase--delete_edge_functions(["apply-recommendations"])` ausführen.
- `supabase/config.toml` Eintrag (falls vorhanden) entfernen.
- Kein aktiver pg_cron-Job existiert mehr (laut Memory bereits abgeschaltet), nichts an Cron zu ändern.

### 6. Hook für Raum-Recommendations (falls eigenständig)
- Prüfen, ob `saveRecommendations`/`loadRecommendations`-Hook nur hier verwendet wird; wenn ja, entfernen. Sonst belassen.

## Was bleibt
- KI-Autopilot (`ai-parameter-advisor`, 15min Cron), Whitelist + `validate_ai_auto_apply`-Trigger.
- `pv-automation` als alleinige Setpoint-Quelle.
- Musteranalyse, Pattern-Recall, Progress-Cockpit, ML-Loop – alle unverändert.
- Tabelle `room_recommendations` bleibt als historisches Datenmodell (kein Migrations-Drop, um Recovery offen zu halten); kann später separat aufgeräumt werden.

## Verifikation
- Build sauber.
- `/` Route: Karte "Heizungs-Optimierung" zeigt nur noch "TGP508 Global" und "ML-Status" (oder Raumweise-Tab mit reinem Status-Text).
- HeatingDashboard unverändert sichtbar, "Alle pushen" + "Sync" funktionieren.
- `supabase functions list` enthält `apply-recommendations` nicht mehr.

## Memory-Update
- `mem://arch/recommendations-not-auto-applied` aktualisieren: Edge Function entfernt, manuelle UI entfernt; nur KI-Autopilot + pv-automation steuern.
