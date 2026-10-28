# TODO - Offene Aufgaben

Stand: 2026-10-28

---

## 🔴 Hohe Priorität

### KI-Batterie-Vorschlag beobachten (seit 28.10.)
- [ ] `battery-soc-decision` deployen (ändert nur noch den Mindest-Ladestand)
- [ ] Vorschläge 2–3 Wochen prüfen statt blind übernehmen; zieht die Regel im Winter nur nach oben (Prognose < 10 kWh → anheben)? Dann Regel überarbeiten (Entwurf im Chat 28.10.: anheben nur, wenn Reserve verfehlt UND ≥ 1 kWh aus der Batterie geheizt)

### Anwesenheit einspielen und testen (seit 28.10.)
- [ ] SQL `07_anwesenheit.sql` ausführen – **danach gilt das Haus ohne Eintrag als leer**; ggf. sofort „Ich bin da bis …“
- [ ] `pv-automation` deployen, App-Update abwarten
- [ ] Einige Tage beobachten: `heating_day_mode.away`, Netzbezug an Abwesenheitstagen, Raumtemperaturen bei Ankunft (Vorlauf 6 h reicht?)
- [ ] Abwesenheitstage im Mustergedächtnis und in der Analyse kennzeichnen/ausklammern (Konzept Anwesenheit §6)
- [ ] Ersparnis in 2–3 Wochen mit kälteren Tagen nachrechnen (Abfragen im Anhang des Konzepts)

### Tagesmodus testen (seit 27.10.)
- [ ] SQL `06_tagesmodus_mindesttemperatur.sql` ausführen, `pv-automation` deployen, App-Update abwarten
- [ ] „Ohne PV“ je Raum prüfen/anpassen (Startwert Eco − 1,5 °C)
- [ ] Eco > Komfort korrigieren: Flur (22/20), Wohnzimmer (22/21), Haustür (22/21)
- [ ] Einige Tage beobachten: Morgenverbrauch, Batterie-Minimum, Raumtemperaturen, `heating_day_mode` (Abfragen im Konzept §8)
- [ ] Fronius: Kann die zeitabhängige Batteriesteuerung das Entladen tagsüber sperren? (Konzept §6.1)
- [ ] Feste Werte aus Konzept §4.3 schrittweise einstellbar machen
- [ ] `rooms.pv_auto_enabled` wird nicht ausgewertet → auswerten oder Schalter entfernen
- [ ] Anzeige „heizt“ (DP 5) prüfen: am 27.10. zeigten alle Räume „nein“ bei 8–10 kW

### api_errors doppelt (Trigger seit 26.10.)
- [x] Trigger `trg_api_errors_dedupe` fasst offene Fehler je Gerät + Typ zusammen (`doc/FIX-API-ERRORS-DOPPELT-2026-10-26.md`)
- [ ] Wirtschaftsraum-Thermostat seit 26.10. ~11:43 offline – Ursache vor Ort/FritzBox prüfen

### ai-parameter-advisor wiederholt offene Vorschläge stündlich
- [ ] Vor dem Insert prüfen, ob für Parameter + Raum schon ein offener Vorschlag existiert → aktualisieren statt neu anlegen (Frontend zählt seit 26.10. nur den neuesten)

### Analyse-Vorschläge (seit 26.10.)
- [ ] Nach einigen Tagen echter Heizdaten prüfen, ob die Regeln zu oft/zu selten auslösen
- [ ] Optional: Whitelist-Eintrag `parallel_heating_capacity` abschalten (SQL in `doc/NEUE-TAB-STRUKTUR-2026-10-26.md` §4)

### Heizzyklen (Trigger seit 26.10.)
- [x] Trigger `trg_log_room_heating_transition` schreibt `heating_start/stop` (`doc/FIX-HEIZZYKLEN-TRIGGER-2026-10-26.md`)
- [ ] Nach 1–2 Tagen: Zyklen prüfen, dann entscheiden, ob `solar_limit_stop` weiter als Heizenergie zählt (Doppelzählung)
- [ ] Block A2 (direkter Insert) im lokalen Dienst entfernen; Dienst-Ordner auf v1.3 bringen

### pv-automation: falscher Erreichbarkeits-Zeitstempel im Lokal-Modus
- [ ] Nach erfolgreichem Setzen schreibt pv-automation `last_thermostat_sync = now` und schließt `api_errors` des Raums – im Lokal-Modus heißt „erfolgreich“ nur „eingereiht“
- [x] Kommentar „automation_enabled controls ONLY ML“ korrigieren (27.10.)

### Collector auf Fronius-Only umstellen
- [ ] Smartfox-Funktion aus `collector-node/index.js` entfernen
- [ ] `saveReading()` vereinfachen (nur Fronius-Daten)
- [ ] `poll()` Funktion anpassen
- [ ] `config.example.json` aktualisieren
- **Details:** Siehe `doc/plan.md`
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
- [ ] **Haustür + Wohnzimmer:** Falls Versions-Sweep (v2.6.0) den Timeout nicht behebt → `local_key` neu holen (Tuya API Explorer/TinyTuya) und in `config.json` eintragen
- ~~Heizhistorie zeigt keine Daten wenn duration_minutes NULL ist~~ (v2.2.2)
- ~~2 Thermostate (Haustür/Wohnzimmer) dauerhaft „connection timed out" durch fixe Protokoll-Version~~ (v2.6.0 — Auto-Versions-Erkennung)
- ~~„Alle pushen" wirft 403 im Lokalmodus~~ (v2.6.0 — modusbewusster Push)

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
