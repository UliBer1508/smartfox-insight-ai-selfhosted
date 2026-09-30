---
name: Globale Temperatur-Defaults entfernt
description: Komfort-/Eco-/Nacht-Temperatur werden ausschließlich pro Raum im RoomManager gepflegt; globale Werte sind reine Code-Fallbacks ohne UI.
type: feature
---

## Regel
Die Felder `comfort_temp`, `eco_temp`, `night_temp` in `heating_settings` haben **keine UI mehr**.
Pflege ausschließlich pro Raum (`rooms.comfort_temp/eco_temp/night_temp`) im RoomManager.

## Hintergrund
Die globalen Defaults waren irreführend: jede Automatisierungs-Logik in `pv-automation/index.ts` greift bevorzugt auf den Raumwert zu (`room.eco_temp || settings?.eco_temp || 19`). Die globale Einstellung war damit ein totes Feld im UI.

## Wirkung
- UI-Sektion „Standard-Temperaturen" in `HeatingSettingsForm.tsx` entfernt.
- DB-Spalten bleiben (Defaults 21/19/18 °C) — dienen nur noch als Code-Fallback, falls ein Raum keinen Wert gesetzt hat.
- Keine Migration, keine Logik-Änderung in Edge Functions.

## How to apply
- Neue Temperatur-Sollwerte immer pro Raum im RoomManager setzen.
- Globale Felder nicht wieder ins UI aufnehmen.
