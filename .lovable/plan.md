## Option B: Globale Komfort-/Eco-/Nacht-Temperatur aus UI entfernen

### Änderungen

**1. `src/components/heating/HeatingSettingsForm.tsx`**
- Sektion „Standard-Temperaturen" mit Feldern `comfort_temp`, `eco_temp`, `night_temp` entfernen (inkl. Labels, Inputs, Validierung).

**2. DB & Edge Function bleiben unverändert**
- Spalten `heating_settings.comfort_temp / eco_temp / night_temp` bleiben (Defaults 21/19/18 °C).
- Fallback-Kette in `pv-automation/index.ts` (`room.eco_temp || settings?.eco_temp || 19`) bleibt als Sicherheitsnetz erhalten.
- Keine Migration nötig.

**3. Memory-Updates**
- Neue Datei `.lovable/memory/features/heating/global-temp-defaults-removed.md`: Pflege ausschließlich pro Raum, globale Werte nur noch Code-Fallback.
- `.lovable/memory/index.md` Core-Hinweis ergänzen.

### Nicht im Scope
- RoomManager (pro-Raum-Pflege bleibt unverändert).
- Keine Logik-Änderung in Edge Functions.
- Keine DB-Migration.