# Changelog

Alle wichtigen Änderungen am Projekt werden hier dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

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
