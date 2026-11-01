# TODO - Offene Aufgaben

Stand: 2026-11-01

---

## 🔴 Hohe Priorität

### KI-Batterie-Vorschlag beobachten (seit 28.10.)
- [ ] `battery-soc-decision` deployen (ändert nur noch den Mindest-Ladestand)
- [ ] Vorschläge 2–3 Wochen prüfen statt blind übernehmen; zieht die Regel im Winter nur nach oben (Prognose < 10 kWh → anheben)? Dann Regel überarbeiten (Entwurf im Chat 28.10.: anheben nur, wenn Reserve verfehlt UND ≥ 1 kWh aus der Batterie geheizt)

### Batterie-Schutz ohne Lücken einspielen (01.11.)
- [ ] SQL `12_batterie_schutz.sql`, dann `supabase functions deploy pv-automation`
- [ ] Nächster Tag: Protokoll › Ereignisse (Modus) – kein Wechsel mehr weg von „Batterie-Schutz“, solange SOC < 75 %; Protokoll › Energie – mittags lädt die Batterie statt der Heizung
- [ ] Untergrenzen prüfen: Zimmer Luca steht auf 22 = Eco

### Protokoll-Modul einspielen (01.11.)
- [ ] SQL `11_protokoll_modul.sql`, `pv-automation` deployen, Thermostat-Dienst v1.4 kopieren + `nssm restart SmartfoxTuya`
- [ ] Test DP 19 = 0 am Büro, nach einem halben Tag Schaltpunkte prüfen (Doku Abschnitt „Erster Test“)
- [ ] Heizleistung Haustür und Toilette Eingang eintragen

### Test Nachtwert statt Frostschutz (ab 01.11.)
- [ ] SQL `10_nacht_protokoll.sql` ausführen (Protokoll + Basis 26.–31.10.)
- [ ] Haus › Nacht auf „Nachtwert halten“, Nachtwert je Raum = Untergrenze
- [ ] Nach 1–2 Wochen auswerten und Tabelle in `doc/TEST-NACHTWERT-2026-11-01.md` füllen

### Anwesenheit umgedreht einspielen (01.11.)
- [ ] SQL `09_abwesenheit_umdrehen.sql` ausführen, direkt danach `pv-automation` deployen, App-Update abwarten
- [ ] Alexa-Function `alexa-heizung` (Repo `heizung-muenchen`) umstellen: „ich bin weg bis …“ / „ich bin zurück“ – bis dahin Alexa-Anwesenheit in Venediger nicht benutzen
- [ ] Nächster Sonnentag: Komfort-Runde im Log (`=== PHASE 2: KOMFORT-RUNDE ===`), auch während einer Abwesenheit
- [ ] Bei der ersten längeren Abwesenheit beobachten: `heating_day_mode.away`, Netzbezug, Raumtemperaturen bei Rückkehr (Vorlauf 6 h reicht?)
- [ ] Abwesenheitstage im Mustergedächtnis und in der Analyse kennzeichnen/ausklammern (Konzept Anwesenheit §6)
- [ ] Ersparnis in 2–3 Wochen mit kälteren Tagen nachrechnen (Abfragen im Anhang des Konzepts)

### Tagesmodus testen (seit 27.10.)
- [ ] SQL `06_tagesmodus_mindesttemperatur.sql` ausführen, `pv-automation` deployen, App-Update abwarten
- [ ] „Ohne PV“ je Raum prüfen/anpassen (Startwert Eco − 1,5 °C)
- [ ] Eco > Komfort korrigieren: Flur (22/20), Wohnzimmer (22/21), Haustür (22/21)
- [ ] Einige Tage beobachten: Morgenverbrauch, Batterie-Minimum, Raumtemperaturen, `heating_day_mode` (Abfragen im Konzept §8)
- [x] ~~Fronius: zeitabhängige Batteriesteuerung~~ – entfällt: an Smartfox/Fronius wird nichts eingestellt (Grundsatz 01.11.2026)
- [ ] Feste Werte aus Konzept §4.3 schrittweise einstellbar machen
- [ ] `rooms.pv_auto_enabled` wird nicht ausgewertet → auswerten oder Schalter entfernen
- [x] Anzeige „heizt“ (DP 5) geprüft 01.11.: stimmt seit v1.3 (am Gerät gegengelesen)

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

### Collector: Smartfox-Datenabruf entfernen
- [ ] Smartfox-Datenabruf aus `collector-node/index.js` entfernen (falls noch vorhanden), `config.example.json` anpassen
- **Hinweis:** Nur die **Daten** des Smartfox werden nicht mehr genutzt. Der Smartfox bleibt als Energiemanager in Betrieb (regelt Batterie, Warmwasser, Auto) – nicht entfernen, nichts daran einstellen.

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
- Messdaten nur vom Fronius; der Smartfox bleibt Energiemanager (Batterie, Warmwasser, Auto)
- Unser System steuert ausschließlich über die Thermostate (01.11.2026)
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
