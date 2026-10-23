# Übersicht & Einstellungen im Aufbau der Heizung München

**Datum:** 23. Oktober 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted`
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffen:** Frontend (Übersicht, Einstellungen, Hooks), pg_cron (neuer Wetter-Job), Tabelle `rooms` (Spalte `pv_boost_max_temp`)

**Zusammenfassung:** Die App heißt jetzt **Heizung Venediger**. Startseite und Einstellungsseite
folgen dem klareren Aufbau der App *Heizung München* (Repo `heizung-muenchen`), behalten aber die
Venediger-Farben. Dabei wurden drei echte Fehler gefunden und behoben: fehlende Wetterdaten seit der
Migration, eine stillgelegte Sonderregel bei voller Batterie in fünf Wohnräumen und eine
Einstellungsseite, die Änderungen anderer Stellen überschreiben konnte.

---

## 1. Umbenennung „Heizung Venediger“

Kopfzeile, Browser-Tab, Anmelde-, Installations- und Offline-Seite, PWA-Name. Kurzname auf dem
Handy: **„Venediger“** (vorher „Heizung“, gleich wie München).

## 2. Neue Startseite „Übersicht“

`src/components/overview/HouseOverview.tsx`, neuer Tab vor „Energie“ (ehemals „Übersicht“).

| Block | Datenquelle |
|---|---|
| Statuszeile | `service_health` (tuya-thermostat), Frische `energy_readings` |
| Betriebsmodus | abgeleitet: Nacht (night_start/end), **PV-Heizen nur wenn `rooms.pv_auto_active`**, sonst Normal mit Begründung |
| Energie-Kacheln | `energy_readings` (Fronius-Vorzeichen: power_io < 0 = Einspeisung, battery_power < 0 = Laden) |
| Überschuss | Einspeisung + Batterieladung, Ladung erst ab `heating_min_battery_soc` |
| Wetter & Prognose | `weather_data`, `pv_forecasts.hourly_watts` |
| Raumkarten | `rooms`; manuelles Übersteuern über den bestehenden Weg (`useTuyaControl.setTemperature`), Dauer 1–24 h |

Die pv-automation wurde **nicht** verändert.

## 3. Wetterdaten fehlten seit der Migration ⭐

`weather_data` war **leer** (0 Zeilen). Der Cron-Job für `fetch-weather` wurde beim Umzug von
Lovable nicht angelegt. Betroffen waren nicht nur die Anzeige, sondern auch pv-automation
(Außentemperatur/Bewölkung für ML-Features) und `ai-daily-planner`.

```sql
select cron.schedule('fetch-weather-hourly', '5 * * * *', $$
  select net.http_post(
    url := 'https://pflnniklvqbwjwrjswaz.supabase.co/functions/v1/fetch-weather',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb); $$);
```
`fetch-weather` hat `verify_jwt = false`, daher kein Schlüssel nötig. Verifiziert: 48 Zeilen.

**Hinweis Zeitstempel:** `fetch-weather` speichert die Wiener Ortszeit von Open-Meteo, geparst in UTC
(Deno). `2026-10-23 13:00:00+00` bedeutet also 13:00 Uhr **Wien**. Die Übersicht rechnet so.

## 4. „Batterie voll“ (`rooms.pv_boost_max_temp`) – Sonderregel war in 5 Räumen aus

**Was die Regel tut** (pv-automation, Battery-Full-Override): tagsüber, Batterie ≥ 95 %,
Einspeisung ≥ 3.000 W, Tagesprognose ≥ 5 kWh → ein Raum fällt nach Erreichen von Komfort **nicht**
auf Eco zurück, solange er unter `pv_boost_max_temp − 0,2 °C` liegt (leer = Komfort + 1,5 °C).
Es ist **kein Sollwert**: der Thermostat bekommt nie mehr als Komfort + 1 °C (Super-Komfort).

**Befund:** Zimmer Uli 22, Zimmer Luis 21, Zimmer Luca 21, Büro 21, Wohnzimmer 22 – jeweils
≤ Komfort, damit war die Regel dort wirkungslos (ausgerechnet Wohnzimmer 2.400 W). Altwerte, nicht
von der KI (alle KI-Vorschläge stehen auf `shadow`).

**Fix:** Werte geleert, alle 12 Räume verhalten sich gleich.
```sql
update rooms set pv_boost_max_temp = null
where trim(name) in ('Zimmer Uli','Zimmer Luis','Zimmer Luca','Büro','Wohnzimmer')
  and pv_boost_max_temp is not null
returning name, comfort_temp;   -- 5 Zeilen
```
Rückweg: alte Werte siehe oben.

**Entscheidung:** Kein Eingabefeld „Batterie voll“ (würde einen nie erreichten Sollwert vortäuschen).
Die Raumkarte zeigt nur die Info „Bei voller Batterie: Komfort halten bis X °C“.

**Nebenbefund:** `ai-parameter-advisor` schlägt stündlich `pv_boost_max_temp = 23` vor; der dort
protokollierte `current_value` stammt aus der Gemini-Antwort, nicht aus der DB (daher „null“).

## 5. Einstellungsseite – Datenverlust-Risiken behoben

| # | Vorher | Jetzt |
|---|---|---|
| 1 | `useHeatingSettings.saveSettings` schrieb die **ganze Zeile** (~65 Felder) aus dem Stand beim Laden. Fünf andere Schreiber (ai-parameter-advisor, battery-soc-decision, ai-parameter-evaluator, AIShadowDecisions, useEnergyPrices) wurden still überschrieben. Betraf auch AnalysisPanel und PatternRecallBlock. | Schreibt **nur übergebene Felder**; vorher Konfliktprüfung gegen den DB-Stand (`src/lib/safeSave.ts`). Bei Konflikt: nicht speichern, neu laden, Hinweis. |
| 2 | Raum-Dialog schrieb das **ganze Raumobjekt** inkl. `target_temp`, `current_temp`, `is_heating`, Lernwerte → alter Sollwert konnte zurück ans Thermostat gehen. | Neue Funktion `useRooms.updateRoomFields(id, patch, base)`: nur editierbare, geänderte Felder, mit Konfliktprüfung. |
| 3 | Mülleimer löschte Raum **ohne Rückfrage** (Kaskade: Heizprotokolle, Temperaturverlauf, ML-Features, gelernte Regeln …). | Löschen nur in „Technik“, mit Erklärung und Eingabe des Raumnamens. |
| 4 | „Jetzt bereinigen“ ohne Rückfrage. | Rückfrage. Datenspeicherung speichert nur geänderte Felder; Hinweis bei Polling-Änderung (Watchdog-Schwellen). |
| 5 | Leere Felder wurden als NULL/NaN gespeichert. | Validierung (Bereiche, Nacht ≤ Eco ≤ Komfort, Stoppen < Heizen ab). |
| 6 | Angezeigte Ersatzwerte ≠ Code (Nacht-Ende 06:00 statt 08:00, Schaltintervall 5 statt 25). | Anzeige = Code-Default, gekennzeichnet als „Standardwert“. Auch in Dashboard/ThermostatCard/Tagesprogramm. |

## 6. Neuer Aufbau der Einstellungsseite

`SettingsPanel.tsx` → **Betrieb** (Lokal/Cloud, Cloud mit Rückfrage) · **Haus**
(`settings/HouseSettingsCard.tsx`: Zeiten, PV-Überschuss, Batterie, Verteilung, Anlage) · **Räume**
(`settings/RoomsSection.tsx`: Karte je Raum, Nacht/Eco/Komfort direkt, PV-Automatik, Technik &
Lernwerte aufklappbar) · Datensammler · Tuya Cloud · Datenspeicherung · Datensicherung · Tarife.
Jeder Abschnitt ist wie früher ausklappbar; der Auf/Zu-Zustand wird je Abschnitt im Browser gemerkt.

**Ausgeblendet (DB-Werte bleiben):** `max_grid_heating_power_w` (gelesen, nie verwendet),
`pv_boost_temp_delta` (gelesen, nie verwendet), Strompreise im Formular (Quelle der Wahrheit ist
`energy_price_history`, gepflegt unter Tarife).
**Priorität** bleibt im Tab „Heizung & KI“ (Unique-Constraint 1–12 erlaubt kein direktes Tauschen).

`HeatingSettingsForm.tsx` und `RoomManager.tsx` werden nicht mehr verwendet und können gelöscht werden.

## 7. PWA-Updates kamen auf dem Handy nicht an ⭐

**Ursache:** `vite.config.ts` hatte `registerType: "autoUpdate"`, aber `workbox.skipWaiting: false`.
Im Auto-Modus sendet `registerSW` kein `SKIP_WAITING` (in `vite-plugin-pwa/dist/client/build/register.js`
nur bei `!auto`), und `onNeedRefresh` wird nie aufgerufen. Der neue Service Worker blieb deshalb im
Zustand *waiting*, solange die App irgendwo offen oder im Hintergrund war – auf dem Handy praktisch immer.

**Fix:** `skipWaiting: true`; in `src/pwa/registerSW.ts` `onNeedReload` statt des wirkungslosen
`onNeedRefresh`. Neu: `vercel.json` mit `Cache-Control: no-cache` für `sw.js`, `workbox-*.js`,
`manifest.webmanifest`, `index.html` (die gehashten Dateien unter `/assets/` bleiben langlebig).

**Einmalig:** Handys mit dem alten Service Worker holen den neuen beim nächsten Öffnen/Wechsel in den
Vordergrund; der neue aktiviert sich selbst und lädt die App einmal neu. Falls nicht: App ganz
schließen und neu öffnen.

## Offen

- `pv_boost_max_temp` aus der KI-Whitelist nehmen (stündliche Wiederholungsvorschläge).
- Doku-Widerspruch bereinigen: `memory/parameter-usage-audit-c.md` nennt `pv_boost_max_temp` „entfernt“, `memory/comfort-saturation-estrich-storage.md` nutzt es aktiv – gilt Letzteres.
- `useHeatingSettings` lädt nur beim Öffnen; ein Reload bei Fenster-Fokus wäre nützlich.

## Gelernt

1. **Ganze Zeilen speichern ist gefährlich, sobald mehrere Stellen schreiben.** Immer nur Geändertes.
2. **Ein Wert, der eine Regel begrenzt, kann sie still abschalten** (Grenze ≤ Startwert).
3. **Nach einer Migration jeden Cron-Job gegen die Liste der Edge Functions prüfen** – `fetch-weather` fehlte vier Monate unbemerkt.
