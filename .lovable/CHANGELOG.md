# Changelog

Alle wichtigen Änderungen am Projekt werden hier dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

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
