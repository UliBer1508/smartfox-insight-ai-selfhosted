
## Diagnose: Felder sind im Code, aber nicht in Published-Version

### Befund
Alle Batterie-relevanten Einstellfelder sind in `src/components/heating/HeatingSettingsForm.tsx` vorhanden (Zeilen 82–401):

| Feld | Zeile | Status |
|---|---|---|
| `min_battery_soc` (Min. Batterie-SOC) | 84–95 | ✅ vorhanden |
| `target_battery_soc` (Ziel-SOC) | 96–107 | ✅ vorhanden |
| `battery_reserve_for_night_soc` (Reserve für Nacht) | 333–350 | ✅ vorhanden (Slider 40–80%) |
| `battery_buffer_enabled` (Puffer-Schalter) | 352–361 | ✅ vorhanden |
| `battery_buffer_bonus_w` (Puffer-Bonus) | 366–385 | ✅ vorhanden (Slider 200–1500W) |
| `tolerant_deactivation_enabled` | 387–396 | ✅ vorhanden |
| `micro_budget_min_battery_soc` (Mikro-Budget SOC) | 296–308 | ✅ vorhanden |

### Ursache
**Frontend-Änderungen gehen nicht automatisch live.** Die Preview (`id-preview--…lovable.app`) zeigt immer den aktuellen Code, die Published-Version (`smartfox-insight-ai.lovable.app`) nur den zuletzt manuell veröffentlichten Stand.

Diese Batterie-Felder wurden offenbar nach dem letzten Publish hinzugefügt → in Production fehlen sie deshalb.

### Lösung (kein Code-Change nötig)

**Du musst nur neu publizieren:**

- **Desktop:** Oben rechts auf den **Publish**-Button (Globus-Icon) klicken → **Update** drücken
- **Mobile:** In der Preview-Ansicht unten rechts auf **…** → **Publish** → **Update**

Nach dem Update sind alle Felder unter Einstellungen → „Anlagen-Konfiguration" → Sektion „Batterie-Reserve für Nachverbrauch" sichtbar.

### Falls du nach dem Republish immer noch nichts siehst
Dann liegt es am Browser-Cache der PWA. In dem Fall:
1. PWA komplett schließen
2. Browser-Cache für die Domain leeren (oder Inkognito-Tab öffnen)
3. Erneut öffnen → Service Worker lädt neue Version

### Kein Code-Plan nötig
Hier braucht es **keine Code-Änderung** — die Felder sind alle da. Es ist rein ein Deployment-Schritt deinerseits.
