# Changelog

Alle wichtigen Änderungen am Projekt werden hier dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [2.15.0] - 2026-11-01

### Added (Lernschleife, `doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md`)
- Tagesnote je Tag nach Ulis Zielen (Nacht · Sonne · Komfort · Netz, je 25 Punkte) mit den Einstellungen des Tages: Tabelle `tages_bewertung`, Bewertung 09:55, Tab Protokoll › Tagesnoten, Eintrag im Protokoll.
- Batterie-Vorschlag nennt den bestbewerteten ähnlichen Tag und dessen Grenze (Vorstufe zu Vorschlägen aus Tagesnoten).

### Changed
- KI lernt nur noch aus Daten ab 26.10.2026 (`learning_data_since`); alte `learned_policies` geleert.

## [2.14.0] - 2026-11-01

### Changed (Batterie-Vorschlag)
- KI-Vorschlag für den Mindest-Ladestand rechnet jetzt mit dem gemessenen Nachtbedarf (Nacht-Protokoll), den Stunden ohne PV am Abend/Morgen und einer einstellbaren Reserve; das Mustergedächtnis (ähnliche Tage) korrigiert die PV-Prognose und zeigt, welche Räume morgen mit der übrigen Sonne heizen können. Alte Regel „trüber Tag → Grenze hoch“ entfernt. SQL `13_batterie_vorschlag.sql`, Konzept Tagesablauf §10.

## [2.13.0] - 2026-11-01

### Fixed (Batterie-Schutz)
- Ladestand-Grenze gilt ohne Ausnahme unter `heating_min_battery_soc`, auch wenn die Batterie lädt (Sonne zuerst in die Batterie); geheizt wird dann nur mit echter Einspeisung.
- Im Batterie-Schutz nur Notfall-Heizen: unter Untergrenze − Abstand (1,0 °C), höchstens 1000 W – neue Werte unter Einstellungen › Haus. SQL `12_batterie_schutz.sql`.
- Protokoll › Energie rechnet Räume ohne eingetragene Leistung mit 800 W (wie die Steuerung).

## [2.12.0] - 2026-11-01

### Added (Test- und Protokoll-Modul, `doc/PROTOKOLL-MODUL-2026-11-01.md`)
- Neuer Tab **Protokoll**: Ereignisse (Sollwerte mit Begründung, heizt an/aus, Tagesmodus, Einstellungen alt → neu, Abwesenheit, Thermostat-Auffälligkeiten, Fehler), Thermostate (alle Datenpunkte, gemessene Schaltpunkte, Auslesen und Datenpunkt testen per Knopf), Energieabgleich je Stunde und Raum, Nächte.
- SQL `11_protokoll_modul.sql`: `protokoll_events` mit Triggern, `thermostat_state`, `thermostat_dp_log`, RPCs für Auswertungen, `thermostat_commands.reason`.
- Thermostat-Dienst v1.4 / Collector v3.1: speichert alle Datenpunkte je Auslesen, Befehle `read_now` und `set_dp` (nur DP 19, 101).
- `pv-automation`: Begründung je Sollwert-Befehl.

### Fixed (Repo)
- Thermostat-Dienst v1.3 vom Österreich-PC ins Repo übernommen (vorher lag v1.1 im Repo).

## [2.11.2] - 2026-11-01

### Added
- Nacht-Protokoll `nacht_protokoll` (SQL `10_nacht_protokoll.sql`): je Nacht und Raum Einstellungen und Ergebnis (Temperaturen, Heiz-kWh, Batterie, Netz, Außen); Cron `nacht-protokoll` stündlich, merkt 21:55 und wertet 09:55 Wiener Zeit aus. Test „Nachtwert halten statt Frostschutz“: `doc/TEST-NACHTWERT-2026-11-01.md`.

## [2.11.1] - 2026-11-01

### Changed
- Raumfeld „Ohne PV“ (`rooms.wait_min_temp`) heißt jetzt **„Untergrenze“** mit Erklärung „Untergrenze bis Sonne“ in Einstellungen › Räume; alle Texte in der App angepasst. Nur Anzeige, keine Logik-Änderung.

## [2.11.0] - 2026-11-01

### Changed (Anwesenheit umgedreht)
- Grundzustand **anwesend**; Einträge im Kalender (`presence_periods`) bedeuten jetzt **Abwesenheit**, Vorlauf vor der Rückkehr (`doc/KONZEPT-ANWESENHEIT-2026-10-28.md` §9) – SQL `09_abwesenheit_umdrehen.sql`.
- Bei Abwesenheit heizt PV-Überschuss wieder bis **Komfort** (Phase 2, kein Eco-Deckel; §8, Entscheidung 30.10.2026).
- App: Schnellschalter „Ich bin weg bis …“ / „Ich bin zurück“, Kalender mit Abreise/Rückkehr, Standard-Abreise 11:00 / Rückkehr 14:00.
- Offen: Alexa-Function `alexa-heizung` (Repo `heizung-muenchen`) umstellen.

---

## [2.10.0] - 2026-10-29

### Added (Alexa)
- Sprachsteuerung über den Alexa-Skill „Meine Heizung“ (gemeinsam mit München, Code im Repo `heizung-muenchen`): Eigenverbrauch/Autarkie, Raumtemperatur, Status, Raum stellen und wieder automatisch, Anwesenheit „Ich bin da bis …“ / „Ich bin weg“. Schreibt auf denselben Wegen wie die App – Beschreibung und Schnittstellen in `doc/ALEXA.md`.

### Added (Anwesenheit)
- Anwesenheit (28.10.2026, `doc/KONZEPT-ANWESENHEIT-2026-10-28.md`): Kalender `presence_periods`, außerhalb gilt das Haus als leer (jeder Tag ein Wartetag, kein Komfort), Vorlauf, Schnellschalter in der Übersicht – SQL `07_anwesenheit.sql`.
- Kalender in Einstellungen › Anwesenheit mit **Monat / Woche / Tag** (29.10.2026): Tage antippen, An-/Abreisetage hell, Vorlauf und Nacht in Woche und Tag, Einträge bearbeiten.
- Standard-Anreise/-Abreise (`presence_arrival_time`, `presence_departure_time`) in Einstellungen › Haus › Anwesenheit – SQL `08_anwesenheit_uhrzeiten.sql`.

---

## [2.9.0] - 2026-10-27

### Changed (Grundkonzept Tagesablauf)
- Neues verbindliches Konzept `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`: Batterie gehört der Nacht, Eco ist Tagesstandard, ist PV-Überschuss absehbar wird gewartet, Überschuss nach Priorität (erst Eco, dann Komfort), KI entscheidet innerhalb der Regeln mit.
- `pv-automation`: Räume ohne Budget bekommen ihr Ziel aus dem **Tagesmodus** (`battery_gate` / `wait` / `grid`) statt pauschal Eco. Im Modus „ohne PV“ Eco nach Priorität bis zur **Max. Heizleistung ohne PV**. Mustergedächtnis verschiebt die Wartetag-Schwelle (max. ±0,3).
- Batterie-Gate und Mikro-Budget-Ende setzen auf **„Ohne PV“** (`rooms.wait_min_temp`) statt Nachtwert.

### Added
- Spalte `rooms.wait_min_temp` („Ohne PV“) – SQL `supabase/SQL/06_tagesmodus_mindesttemperatur.sql`, Feld in Einstellungen › Räume.
- „Max. Heizleistung ohne PV“ (`max_grid_heating_power_w`) wieder in Einstellungen › Haus.
- Übersicht zeigt den Tagesmodus; Protokoll je Lauf in `system_settings.heating_day_mode`.

### Fixed
- Pingpong Batterie-Gate ↔ Raumschleife (Nachtwert/Eco alle 5 Min, bis 269 Entscheidungen je Morgen).
- „Eco=Nacht → direkt Komfort“ umging das Komfort-Budget (Büro, Zimmer Uli).
- Komfort-Upgrade ohne echtes Eco-Budget.
- `set_mode` scheiterte bei jedem Befehl (`value_text` vs. `value`) – entfällt, v1.3 setzt den Modus beim Sollwert.
- Tagesmodus-Ziele erzeugen keine geschätzten `solar_limit_*`-Heizenergien mehr.

### Documentation
- Master-Doku §2–§4, §7, §9, §10, §12, §14, §18–§20, Memory-Specs, ARCHITECTURE, TODO nachgezogen (Nachtzeiten, SOC-Schwellen, Hard-PV-Gate 300 W/8 kWh, DP-Mapping v1.3, Takt 5 Min).

---

## [2.8.0] - 2026-10-26

### Changed (Tab-Struktur nach Zweck)
- 4 Tabs statt 5: **Übersicht** (jetzt) · **Analyse** (Rückblick) · **KI** (prüfen & entscheiden) · **Einstellungen**. Energie, Heizung & KI und Verlauf & Muster sind aufgelöst, keine Karte geht verloren.
- Übersicht zusätzlich: Fehlerbanner, Hinweis auf offene KI-Vorschläge, Energiefluss, Raum-Status & Heizleistung.
- Einstellungen zusätzlich: Heiz-Reihenfolge (▲▼), Abschnitt KI (Autopilot, Modus je Parameter, Mustergedächtnis, Zeitplan & Datenpflege), Systeminfo beim Datensammler.

### Added
- Analyse-Tab mit Tagesbilanz (PV-Verwendung, Batterie, Heizung je Raum mit Herkunft Sonne/Batterie/Netz, Kosten) und „Das Wichtigste“: Befunde mit Einstellungs-Vorschlag, angewendet erst nach Bestätigung, protokolliert in `ai_parameter_decisions`.
- KI-Tab mit Zähler offener Entscheidungen; Parameter-Vorschläge mit Ablehnen und Filter „Zu entscheiden“.

### Fixed
- Kosten-Widget bekommt immer die Werte von heute (es speichert sie als heutigen Tag).
- `parallel_heating_capacity` wird nicht mehr als Parameter angewendet (überschrieb den Heizplan der pv-automation).

### Removed
- `HeatingDashboard`, `DailyHeatingSchedule`, `BatteryStatus`, `AnalysisPanel`, `EnergyStats`, `ConnectionStatus`, `EnergyChart`, `useHeatingAnalysis` (Inhalte umgezogen oder ersetzt).

Details: `doc/NEUE-TAB-STRUKTUR-2026-10-26.md`

---

## [2.7.1] - 2026-10-26

### Fixed (Heizzyklen)
- Seit Wochen kein `heating_start`/`heating_stop`: bis 24.10. war `is_heating` immer false (falsches DP), danach scheiterte der Insert des lokalen Dienstes an RLS. Neuer Datenbank-Trigger `trg_log_room_heating_transition` (SECURITY DEFINER) protokolliert jeden Wechsel von `rooms.is_heating` mit Dauer und Energie, ohne Duplikate zum Cloud-Sync. SQL: `supabase/SQL/04_heizzyklen_trigger.sql`, Details: `doc/FIX-HEIZZYKLEN-TRIGGER-2026-10-26.md`

---

## [2.7.0] - 2026-10-26

### Changed (Thermostat-Steuerung aufgelöst)
- Karte „Thermostat-Steuerung“ im Tab Heizung & KI entfernt. Übersteuern in der **Übersicht**, Grundwerte und neuer Schalter **Automatik** in **Einstellungen › Räume**, „Alle Sollwerte erneut senden“ und „Werte aus der Tuya Cloud lesen“ (nur Cloud-Modus) in **Einstellungen › Betrieb**.
- Übersicht zeigt die Hinweise „Estrich-Speicher“ und „Solar bis …“.
- Neue Räume werden mit `automation_enabled = true` angelegt.

### Fixed
- `automation_enabled` war als „Auto-Empfehlung (KI)“ beschriftet, ist aber der Hauptschalter des Raums (pv-automation steuert nur Räume mit `true`).
- „Alle pushen“ im Lokal-Modus setzte `last_thermostat_sync` ohne echte Lesung → konnte Offline-Fehler verdecken.
- `syncAllStatus` meldet ehrlich, ob gelesen, gesperrt (60 Min) oder Kontingent erschöpft.

### Removed
- `ThermostatCard.tsx`, `StatusLegend.tsx`, `useAutomation.ts`, `RoomManager.tsx`, `HeatingSettingsForm.tsx`, toter Sync-Code in `RoomStatusTable`.

Details: `doc/THERMOSTAT-STEUERUNG-AUFGELOEST-2026-10-26.md`

---

## [2.6.0] - 2026-06-10

### Fixed (Thermostat-Sync: 2 Geräte dauerhaft offline)
- **Auto-Protokoll-Versions-Erkennung** (`local-collector/collector-node/tuya-thermostat.js`): Haustür (seit 09.05.) und Wohnzimmer (seit 26.05.) timeten beim TuyAPI-Handshake dauerhaft mit „connection timed out" aus, obwohl der TCP-Preflight auf Port 6668 bestand (Port offen, Handshake scheitert). Ursache: fest verdrahtete `version: '3.3'` — nach Firmware-OTA können einzelne TGP508 auf 3.4/3.5 wechseln. Der Collector probiert nun bei Connect-Fehler automatisch **3.3 → 3.4 → 3.5** durch, merkt sich die funktionierende Version pro Gerät (`versions`-Map) und nutzt sie künftig direkt.
- **`ensureConnected` gibt aktive Instanz zurück**: Bei Versionswechsel wird die TuyAPI-Instanz neu erstellt; alle Aufrufer (`getStatus`/`setTemperature`/`setMode`) verwenden jetzt die zurückgegebene Instanz statt einer veralteten Referenz.
- **Optionales `version`-Feld** pro Gerät in `config.json` wird respektiert (Default `3.3`).
- **Hinweis:** Bleibt der Timeout trotz Versions-Sweep, ist der `local_key` veraltet (Gerät wurde in der Tuya/Smart-Life-App neu gekoppelt → Key rotiert) und muss neu geholt werden.

### Changed (UI Konsistenz & Desktop-Layout)
- **Desktop-Layout** (`src/pages/Index.tsx`): 2-Spalten-Layout schaltet jetzt ab `md` (768px) statt `lg` (1024px); Leistungsverlauf-Chart über volle Breite.
- **Push-All modusbewusst** (`src/hooks/usePushAllTemps.ts`): Im **Lokalmodus** werden `thermostat_commands` direkt aus `rooms.target_temp` eingefügt (LAN-Pickup, keine Cloud-Quota); im **Cloudmodus** weiterhin `tuya-control/push-all-temps`. Einheitliches Rückgabeobjekt `{ success, successCount, totalCount }`. Behebt den 403-Fehler beim „Alle pushen" im Lokalmodus.
- **Tagesprogramm-Badge zeigt Ist-Zustand** (`src/components/heating/DailyHeatingSchedule.tsx`): Badge/Spalten folgen dem tatsächlichen `target_temp` pro Raum statt nur dem theoretischen PV-Modus. Bei Komfort-Sättigung (Räume auf Eco trotz „Komfort"-Plan) erscheint Hinweis „Komfort gesättigt".

---

## [2.5.0] - 2026-04-28


### Changed (Parallele Heizungs-Allokation + UI-Feedback)
- **Parallele Eco-Aktivierung** (`pv-automation`): Bei ausreichendem Export werden mehrere Räume gleichzeitig auf Eco gestartet — pro Raum genau **ein** Tuya-Call, kein zusätzlicher Prüf-Call. Sobald Budget frei wird (Raum erreicht Target oder mehr Solar verfügbar), wird der nächste Raum aufgenommen. Berücksichtigt `parallel_heating_capacity`, dynamischen Baseload-Puffer, symmetrischen Trend-Bonus und Forecast-Lookahead.
- **UI-Sofortfeedback** (`RoomStatusTable`): Neue Badge-States — „Eco gesetzt" / „Komfort gesetzt" (blau) erscheint sofort nach Command-Absetzung, wechselt auf „Heizt · XW" (rot) sobald physisches Heizen via Logs/`is_heating` bestätigt ist. „Wartend" (orange) wenn Automation aktiv aber kein Budget.
- **Schnelleres Polling** (`useRooms`, `useActiveHeatingRooms`): 30s → **15s** für snappiere Reaktion nach Aktivierungen.
- **Setpoint-Detection**: Zeit-Heuristik (10min) entfernt — Aktivierung wird state-basiert erkannt (`target_temp ≥ eco_temp − 0.2`).

---

## [3.1.0] - 2026-04-20

### Fixed (Battery-Drain-Schutz gehärtet)
- **SOC-Gate erweitert** (`pv-automation`): greift jetzt auch bei `batteryPower ≈ 0` (idle/leere Batterie) und bei Netzbezug (`power_io > 50W`). Schließt den Bug, durch den die Batterie am 2026-04-19 trotz 80%-Regel auf 5% leerlief.
- **Komfort-Hard-Lock**: `comfortBudget = 0` sobald `SOC < heating_min_battery_soc`, unabhängig vom Lade-/Entladezustand. Verhindert dass vormittags gesetzte Komfort-Targets bei späterem SOC-Drop weiterlaufen.
- **Aktive Notfall-Stops `[SOC-GATE-STOP]`**: Bei Gate-Aktivierung im strict-Modus werden jetzt alle Räume mit `target > night_temp` oder `is_heating=true` per `thermostat_commands`-Insert (Local-Service-Pickup) auf `night_temp` zurückgesetzt — funktioniert auch bei erschöpfter Tuya-Cloud-Quota.
- **Critical-Eco-Transition** läuft nur noch im Morgenfenster (09:00–09:29 Wien), nicht mehr fälschlich abends. Spart Tuya-Quota.
- **ML-Exploration-Throttle**: pro Raum max. 1× LLM-Exploration / 30 Min, persistiert in `system_settings.ml_exploration_throttle`. Verhindert Gemini-429-Rate-Limits und entlastet Tuya-Quota.

---

## [2.2.2] - 2026-01-13

### Fixed
- **Heizhistorie-Anzeige repariert** - Chart zeigte keine Daten für heute
  - `.single()` durch `.maybeSingle()` ersetzt in tuya-control
  - Fallback-Duration von 2 Minuten wenn kein heating_start gefunden
  - Filter-Korrektur: `duration_minutes != null && > 0`
  - NULL-Einträge in der Datenbank repariert via Migration

---

## [2.2.1] - 2026-01-12

### Fixed
- **PV-abhängige Temperatur-Regeln** - Strikte Regeln für `room_heating_optimization`
  - Komfort-Temp nur bei PV >= 800W oder SOC > 80%
  - Eco-Temp bei PV < 800W und SOC 30-80%
  - Nacht-Temp bei PV = 0W und SOC < 30%
  - **VERBOTEN: Komfort bei PV = 0W und SOC < 50%**
  - Korrigiert Bad Uli 22°C-Empfehlung ohne PV-Überschuss

---

## [2.2.0] - 2026-01-12

### Fixed
- **Heizungstyp-Konsistenz** - KI-Empfehlungen berücksichtigen jetzt den Heizungstyp
  - `analyze-patterns` Edge Function übergibt `heating_type` in allen 5 Analyse-Modi
  - Keine irrelevanten Wärmepumpen-Tipps mehr für direkte elektrische Fußbodenheizung
  - Explizite Anweisung an KI: "KEINE Wärmepumpen-Tipps!" bei `direct_electric`

### Added
- **useHeatingSettings Default-Erweiterung**
  - `heating_type: 'direct_electric'` als Standard
  - `total_heating_power_w: 5200` (Summe aller Räume)
  - `night_cycling_enabled: true`
  - `avg_night_cycles_per_room: 3`

---

## [2.1.0] - 2026-01-10

### Added
- **DailyHeatingSchedule** - Neue Komponente für übersichtliches Heizungs-Tagesprogramm
  - Zeigt alle 4 Heizungsmodi (Nacht/Eco/Komfort/Batterie-Schutz)
  - Tabellarische Übersicht aller Räume mit Temperaturen pro Modus
  - Separate Spalten für PV-Automatik (☀️) und KI-Empfehlungen (🤖)
  - Echtzeit-Anzeige des aktuellen Modus basierend auf Zeit, PV-Überschuss und Batterie

### Changed
- **LearningProgress** kompakter gestaltet
  - Nur noch 3 Kennzahlen im Header (Samples, Confidence, Ø Reward)
  - Details in Collapsible-Bereich verschoben
  - Zeigt nur noch die letzten 3 statt 5 Entscheidungen

### Documentation
- SYSTEM_DOCUMENTATION.md mit neuen Komponenten aktualisiert
- Heizungs-Modi und Automatik-Schalter dokumentiert

---

## [2.0.0] - 2026-01-09

### Security
- RLS (Row Level Security) auf allen 18 Tabellen aktiviert
- Einheitliche Policies für authentifizierte Benutzer implementiert
- Sicherheitsmodell in Dokumentation aufgenommen

### Fixed
- Heizungsverbrauch-Berechnung über Mitternacht korrigiert
- Heating consumption hook refaktoriert für korrekte Zyklen-Erkennung

### Added
- SYSTEM_DOCUMENTATION.md mit vollständiger Systemreferenz
- Entscheidungsprotokoll (Decision Log) dokumentiert
- Bekannte Limitierungen erfasst

### Changed
- Collector-Umstellung auf Fronius-Only geplant (siehe plan.md)

---

## [1.5.0] - 2026-01-08

### Added
- ML-Feature-Extraktion für Räume (room_ml_features Tabelle)
- Learning Events für Entscheidungstracking
- Solargewinn-Analyse pro Raum

### Changed
- Heizungsoptimierung berücksichtigt jetzt berechnete Raumleistung

---

## [1.4.0] - 2026-01-07

### Added
- Raumtemperatur-Sampling für ML-Training
- PV-Automatik mit konfigurierbaren Schwellwerten
- Nacht-Cycling für Estrichspeicher

### Fixed
- Tuya-Thermostat Synchronisation verbessert

---

## [1.3.0] - 2026-01-06

### Added
- Energiekosten-Berechnung (energy_daily_costs Tabelle)
- Strompreis-Konfiguration in heating_settings
- Kostenübersicht-Widget im Dashboard

---

## [1.2.0] - 2026-01-05

### Added
- PV-Forecast Integration über forecast.solar API
- Heizungsempfehlungen basierend auf Wettervorhersage
- Raum-Orientierung für Solargewinn-Berechnung

---

## [1.1.0] - 2026-01-04

### Added
- Tuya-Integration für Thermostatsteuerung
- Room Heating Logs für Verbrauchsanalyse
- Consumer Logs für Großverbraucher-Tracking

---

## [1.0.0] - 2026-01-03

### Added
- Initiales PWA-Setup mit Vite + React + TypeScript
- Supabase-Integration für Datenbank
- Local Collector (Python + Node.js Varianten)
- Energy Readings Erfassung von Smartfox/Fronius
- Basis-Dashboard mit Energiestatistiken
- Raumverwaltung mit Thermostaten
- Benutzerauthentifizierung

---

## Template für neue Einträge

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Neue Features

### Changed
- Änderungen an bestehendem Verhalten

### Deprecated
- Features, die in Zukunft entfernt werden

### Removed
- Entfernte Features

### Fixed
- Bugfixes

### Security
- Sicherheitsrelevante Änderungen
```
