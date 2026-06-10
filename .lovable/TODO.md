# TODO - Offene Aufgaben

Stand: 2026-06-10

---

## 🔴 Hohe Priorität

### Collector auf Fronius-Only umstellen
- [ ] Smartfox-Funktion aus `collector-node/index.js` entfernen
- [ ] `saveReading()` vereinfachen (nur Fronius-Daten)
- [ ] `poll()` Funktion anpassen
- [ ] `config.example.json` aktualisieren
- **Details:** Siehe `.lovable/plan.md`
- **Grund:** Smartfox wird nicht mehr verwendet

### Energy_in/Energy_out Werte
- [ ] Klären ob diese Werte benötigt werden
- [ ] Falls ja: Smart Meter Integration prüfen
- **Status:** Fronius liefert keine kumulierten Energiezähler

---

## 🟡 Mittlere Priorität

### ML-Feature Verbesserungen
- [ ] Mehr Trainingsdaten sammeln (mind. 7 Tage)
- [ ] Confidence-Schwellwert für Empfehlungen festlegen
- [ ] Solar Gain pro Raum-Orientierung auswerten

### Dashboard Optimierungen
- [ ] Ladezeit bei vielen Datenpunkten verbessern
- [ ] Offline-Caching für Charts erweitern
- [ ] Mobile Ansicht für Thermostat-Cards optimieren

### Heizungs-Automatik
- [ ] Wetter-Vorhersage in Entscheidungen einbeziehen
- [ ] Vorheiz-Zeit basierend auf Außentemperatur anpassen
- [ ] Nacht-Cycling Logik verfeinern

---

## 🟢 Niedrige Priorität / Ideen

### Neue Features
- [ ] Push-Benachrichtigungen bei PV-Überschuss
- [ ] Historische Kostenanalyse (Monat/Jahr)
- [ ] Export-Funktion für Energiedaten (CSV/JSON)
- [ ] Vergleich mit Vorjahr/Vormonat

### Code-Qualität
- [ ] Unit Tests für kritische Hooks
- [ ] E2E Tests für Heizungssteuerung
- [ ] Storybook für UI-Komponenten

### Performance
- [ ] Database Indizes optimieren
- [ ] Edge Function Cold Starts reduzieren
- [ ] Bundle Size analysieren und optimieren

---

## 🐛 Bekannte Bugs

### Behoben ✅
- ~~Heizungsverbrauch-Berechnung über Mitternacht falsch~~ (v2.0.0)
- ~~RLS Policies fehlten auf einigen Tabellen~~ (v2.0.0)
- ~~ML-Status war zu ausführlich und unübersichtlich~~ (v2.1.0)
- ~~Keine klare Übersicht der Heizungsmodi pro Raum~~ (v2.1.0)
- ~~Automatik-Schalter (PV vs KI) waren nicht klar unterscheidbar~~ (v2.1.0)
- ~~KI-Empfehlungen enthielten irrelevante Wärmepumpen-Tipps~~ (v2.2.0)
- ~~Heizungstyp wurde nicht konsistent an alle KI-Analysen übergeben~~ (v2.2.0)

### Offen
- [ ] Thermostat-Sync zeigt manchmal alten Wert (Cache-Problem?)
- [ ] Chart-Tooltip überlappt bei vielen Datenpunkten
- ~~Heizhistorie zeigt keine Daten wenn duration_minutes NULL ist~~ (v2.2.2)

---

## 📝 Notizen

### Architektur-Entscheidungen
- Smartfox wird durch reine Fronius-Lösung ersetzt
- RLS ist aktiviert, aber ohne User-Isolation (Single-Tenant)
- Collector läuft lokal, nicht als Edge Function (Netzwerk-Zugriff)

### Externe Abhängigkeiten
- forecast.solar API für PV-Vorhersage
- Open-Meteo API für Wetterdaten
- Tuya Cloud API für Thermostat-Steuerung

---

## Legende

| Symbol | Bedeutung |
|--------|-----------|
| 🔴 | Hohe Priorität - Bald erledigen |
| 🟡 | Mittlere Priorität - Bei Gelegenheit |
| 🟢 | Niedrige Priorität - Nice to have |
| 🐛 | Bug |
| ✅ | Erledigt |
