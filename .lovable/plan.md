# Konsolidierung der Batterie-SOC-Anzeigen

## Befund: Warum es heute 3 Anzeigen gibt

Aktuell sieht der User SOC-Werte an drei Stellen, die aus **zwei verschiedenen DB-Spalten** und **zwei verschiedenen Empfehlungs-Pipelines** gespeist werden:

| # | Ort | Zeigt | Quelle |
|---|-----|-------|--------|
| 1 | Overview-Card `BatteryReserveStatus` (Bild 1) | „Reserve 70%", „Puffer-Grenze 90%", „Heizung-Sperre ab 80%", „Empfehlung: decrease reserve to 65" | `heating_settings.battery_reserve_for_night_soc` (deprecated, 70%) + `heating_min_battery_soc` (80%) + `system_settings.battery_reserve_validation` (Edge-Function `validate-battery-reserve`) |
| 2 | Settings-Slider (Bild 2) | „Mindest-SOC für Nacht-Reserve: 80%" + Info-Box „Mindest-SOC für Heizung (z.B. 75%)" | `heating_settings.heating_min_battery_soc` |
| 3 | KI-Card `BatterySocSuggestionCard` (Bild 3) | „KI Batterie-Empfehlung" / „Kein offener Vorschlag" | Tabelle `battery_soc_suggestions` (KI-Pipeline mit Accept/Dismiss) |

### Probleme
- **Doppel-Feld:** `battery_reserve_for_night_soc` ist laut Memory deprecated (`soc-thresholds-consolidated`) und wird beim Speichern auf `heating_min_battery_soc` gespiegelt. Im Overview-Card wird es trotzdem als separater Wert (70%) angezeigt — daher die widersprüchlichen Zahlen 70 vs 80.
- **Doppel-Empfehlung:** „Empfehlung: decrease reserve to 65" stammt aus `validate-battery-reserve` (älterer Heuristik-Pfad, in `system_settings`), während „KI Batterie-Empfehlung" aus der neueren `battery_soc_suggestions`-Pipeline kommt. Beide schlagen denselben Wert vor — ohne Bezug zueinander.
- **Info-Box in Settings** suggeriert einen eigenen Wert „z.B. 75%" — verwirrend, weil es derselbe Slider ist.

## Ziel
Ein einziger SOC-Wert (`heating_min_battery_soc`), ein einziger Empfehlungs-Kanal (`battery_soc_suggestions`), Overview-Card als kanonische Anzeige inkl. inline KI-Vorschlag.

## Änderungen

### 1. `BatteryReserveStatus.tsx` — Overview-Card wird Single Source
- Entferne separates Lesen von `battery_reserve_for_night_soc`. Skala basiert ausschließlich auf `heating_min_battery_soc`.
- Beschriftung neu:
  - linker roter Bereich = „Heizung-Sperre {soc}%" (statt „Reserve 70%")
  - Puffer-Grenze entfernt (oder als „+20% Puffer" Kontext, da reine Logik-Konstante)
- Entferne den Block „Empfehlung: decrease reserve to 65" (alte `validate-battery-reserve`-Suggestion).
- Integriere stattdessen direkt den **pending KI-Vorschlag** aus `useBatterySocSuggestions`: kompakter Inline-Hinweis „KI schlägt 65% vor [Übernehmen] [Verwerfen]". Wenn kein Pending → nichts zeigen (oder dezenter „Validierung läuft täglich nach 09:00").
- Letzter Morgen-SOC + Nachtverbrauch bleiben als Validierungs-Info (informativ, keine Empfehlung).

### 2. `AutomationStatusCards.tsx` — separates `BatterySocSuggestionCard` entfernen
- Die KI-Empfehlung lebt jetzt im Overview-Card. Entferne die eigenständige Card aus dem Dashboard-Render-Tree (in `HeatingDashboard.tsx`).
- `BatterySocSuggestionCard`-Komponente selbst kann bleiben (z.B. für History-Ansicht in Settings), aber nicht mehr im Dashboard rendern.

### 3. `HeatingSettingsForm.tsx` — Aufräumen
- Die Info-Box „Batterie-Mindest-SOC für Heizung (z.B. 75%) — Diese Einstellung wird manuell gesetzt…" reduzieren auf einen Satz unter dem Slider („Dieser Wert ist das harte SOC-Gate für die Heizung. KI-Vorschläge erscheinen in der Übersicht.").
- Beibehalten: Slider + KI-Vorschläge-Toggle + Migrations-Hinweis.

### 4. Keine DB-/Backend-Änderungen
- `battery_reserve_for_night_soc` bleibt in DB (Backwards-Compat mit Edge-Functions, wird weiter auf Save gespiegelt).
- `validate-battery-reserve` schreibt weiter in `system_settings.battery_reserve_validation` — wir konsumieren nur noch die Validierungs-Daten (Morgen-SOC, Nachtverbrauch), nicht mehr das `suggestion`-Feld. KI-Pipeline (`battery_soc_suggestions`) bleibt der einzige Empfehlungs-Output.

## Verifikation
- Overview-Card zeigt nur noch eine Zahl (80%) und ggf. einen KI-Vorschlag mit Accept-Button.
- Settings-Slider zeigt denselben Wert; Änderung dort reflektiert in Overview.
- Dashboard hat keine separate „KI Batterie-Empfehlung"-Card mehr.
- Build + Type-Check.

## Geänderte Dateien
- `src/components/heating/BatteryReserveStatus.tsx`
- `src/components/heating/AutomationStatusCards.tsx` (Card-Export bleibt, Dashboard nutzt sie nicht mehr)
- `src/components/heating/HeatingDashboard.tsx` (Render entfernen)
- `src/components/heating/HeatingSettingsForm.tsx` (Info-Box kürzen)
