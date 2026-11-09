# TODO - Offene Aufgaben

Stand: 2026-11-09

---

## 🔴 Hohe Priorität

### Sonne auf dem Fühler + DP 19 (09.11., `FIX-FUEHLER-SONNE-UND-DP19-2026-11-09.md`)
- [x] SQL `28_fuehler_plausibel.sql` ausgeführt 09.11. 18:28 (Wohnzimmer 3 Spitzen / 58 Werte, sonst 0; 37.611 Werte DP-19-korrigiert; erste Live-Lesung 18:28 ok)
- [ ] PR mergen → `pv-automation` (GitHub-Aktion), App (Vercel)
- [ ] Nächster Sonnenvormittag: Protokoll „Fühler in der Sonne“ im Wohnzimmer, Raumkarte zeigt den Hinweis, Ende nach Abfall
- [ ] **Kinder Bad DP 19 noch −10:** über Protokoll › Thermostate erneut auf 0 setzen und nach 10 min prüfen; danach Altdaten Kinder Bad +1,0 °C (Zeile in `fuehler_korrektur`) und genehmigte Untergrenze 21 °C prüfen
- [ ] Thermostat-Dienst: `set_dp` nach dem Zurücklesen prüfen (Wert übernommen?) und sonst Fehler melden statt „ausgeführt“
- [ ] `tuya-control` (Cloud): bei jeder Lesung `last_thermostat_sync` setzen, sonst greift die Fühler-Prüfung dort nicht
- [ ] DP 110 (Fühlerwahl) steht bei Bad Uli und Toilette Eingang auf "3", sonst "1" – klären, ob gewollt
- [ ] Einstellungen nach DP-19-Umstellung neu bewerten: seit 06.11. zeigen die Räume 1 °C mehr bei gleicher Luft → gleiche Sollwerte = ~1 °C kühler als vorher

### Vorrang „allein heizen“ geht nach einem Lauf verloren (Befund 09.11.)
- [ ] Wohnzimmer (5550 W > Grenze 4000 W) bekommt nach 60 min Warten für **einen** Lauf „heizt allein“, im nächsten Lauf fällt es aus `cap_wait_state` und wartet wieder (09.11.: sechsmal, ~95 min Heizzeit am Tag, Untergrenze nie erreicht). Konzept FIX-HEIZLEISTUNG: „heizt allein – nur bis Untergrenze“. Fix: Platz behalten bis Ziel erreicht; Nebenwirkungen prüfen
- [ ] Grenze belegt durch zugeteilte Räume, die gar nicht heizen (innerhalb der Schaltdifferenz) – zählen nach DP 5?
- [ ] Konzeptfrage an Uli: Wohnzimmer an Tagen ohne Sonne nur bis Untergrenze oder bis Eco?

### Heizplaner im Schattenbetrieb (06.11., `KONZEPT-PLANER-2026-11-06.md`)
- [x] SQL `25_heizplaner.sql` ausgeführt, Raummodelle + PV-Modell + Gegenrechnung 05.11. eingetragen (06.11.)
- [ ] PR mergen → `heizplaner` + `analysis-scheduler` deployt; KI › Planer zeigt alle 15 min einen neuen Plan
- [ ] Morgen früh: Gegenrechnung 06.11. in KI › Planer, Raummodelle um 03:00 neu gelernt?
- [ ] Einige Tage beobachten: Plan plausibel? Gewichte (0,6 / 2 / 1,5 °C) passend?
- [ ] Wünsche je Raum und Uhrzeit (Belegung: Wohnzimmer, Zimmer Luis tagsüber …)
- [ ] Nach Freigabe: Modus „steuern“ bauen, Regelwerk schrittweise abbauen

### Heizleistung unter Kontrolle (06.11., `FIX-HEIZLEISTUNG-2026-11-06.md`)
- [x] Raumleistungen auf Messwerte gesetzt (06.11. 08:40)
- [x] SQL `24_heizleistung_messung.sql` ausgeführt (06.11.)
- [ ] PR mergen → `pv-automation`, `measure-room-power`, `analysis-scheduler` per GitHub-Aktion deployt?
- [ ] Heute Abend nach Nachtbeginn: Übersicht › Raumkarten „Automatik: …“, Karte „Heizung jetzt“ (Grenze 4 kW eingehalten?)
- [ ] Morgen 09:30: `raum_leistung_messung` gefüllt, Vorschläge in KI › Zu entscheiden plausibel?
- [ ] Toilette Eingang: hängt eine Heizung am Thermostat? (heizt-Meldung ohne Verbrauch, ~100 W)
- [ ] Zimmer Uli: Leistung 2000 W nur aus 5 Messwerten – Messung beobachten

### Systemstatus einspielen (05.11.)
- [x] SQL `22_systemstatus.sql` ausgeführt, Cron `system-alert-5min` läuft (05.11.)
- [x] Secret `SYSTEM_AGENT_TOKEN`; Functions `system-agent`, `system-alert` deployt
- [x] Österreich-PC und München-PC: Dienste-Wächter läuft; Neustart alexa-bridge aus der App getestet
- [ ] Mail: Secrets `MAIL_USER`, `MAIL_PASS`, `ALERT_EMAIL`, dann Test-Mail über falsche Webseite (§7)
- [ ] Österreich: `git pull` + `nssm restart DiensteWaechter` (Wächter-Stand 6fc7340 wie München)
- [ ] München: schönere Anzeigenamen in `config.json` (optional)

### Eco als Ziel + Raummodell einspielen (02.11.)
- [ ] SQL `17_eco_ziel.sql` und `18_raummodell.sql` ausführen
- [ ] Österreich-PC: `git pull`, `supabase functions deploy pv-automation`, `supabase functions deploy fetch-weather`
- [ ] App: Protokoll › Raummodell › „Außentemperaturen nachtragen und neu berechnen“
- [ ] Logs prüfen: `[TAGESART]`, `[SOC-GATE] offen`, `[TAGESMODUS] grid`, `[VORAUSSCHAU]`
- [ ] k-Werte plausibel? „morgen ohne Heizen“ gegen gemessene Morgentemperatur vergleichen
- [ ] Reichen 2000 W `max_grid_heating_power_w` im Winter, damit alle Räume Eco erreichen?

### KI-Vorschläge (Konzept freigegeben 02.11.)
- [x] Evaluator ohne Auto-Rücknahme (nur Hinweis), SQL `19_ki_nur_vorschlaege.sql`
- [ ] Secret `SUPABASE_ACCESS_TOKEN` in GitHub anlegen → Auto-Deploy aktiv
- [x] Whitelist nach §3 (SQL 20, 04.11.)
- [x] gebaut 04.11.: Tagesanalyse 10:00, KI › Zu entscheiden, Wirkungsbericht nach 3 Tagen (PR „KI › Zu entscheiden“)
- [ ] SQL `21_ki_zu_entscheiden.sql` ausführen, Functions `ki-tagesanalyse`, `analysis-scheduler`, `battery-soc-decision` deployen
- [ ] Test: `analysis-scheduler?force=ki_tagesanalyse` – Rückblick und Vorschläge in KI › Zu entscheiden prüfen
- [ ] nach 1–2 Wochen: lösen die drei Regeln zu oft/zu selten aus? Texte verständlich?
- [ ] später: Priorität und Schwelle Sonnentag vorschlagsfähig machen; `ai-parameter-advisor` (Hauptpfad) aufräumen

### KI-Batterie-Vorschlag beobachten (seit 28.10.)
- [ ] `battery-soc-decision` deployen (ändert nur noch den Mindest-Ladestand)
- [ ] Vorschläge 2–3 Wochen prüfen statt blind übernehmen; zieht die Regel im Winter nur nach oben (Prognose < 10 kWh → anheben)? Dann Regel überarbeiten (Entwurf im Chat 28.10.: anheben nur, wenn Reserve verfehlt UND ≥ 1 kWh aus der Batterie geheizt)

### Lernschleife einspielen und begleiten (01.11.)
- [ ] SQL `14_lernschleife.sql`; `supabase functions deploy update-learned-policies` und `ai-parameter-advisor`
- [ ] SQL `16_tagesnote_komfort_fix.sql` ausführen (Komfort-Note korrigiert, Auswertung je Raum)
- [ ] SQL `15_altdaten_loeschen.sql`: erst Vorschau, dann Löschen (Sicherung von heute Nacht prüfen)
- [ ] 02.11. 09:55: erste Tagesnote (01.11.) unter Protokoll › Tagesnoten prüfen
- [ ] nach einer Woche: passen die Noten zu Ulis Einschätzung? sonst Gewichte im Konzept §4 anpassen
- [ ] nach ~2 Wochen: Stufe 3 bauen (Vorschläge aus bestbewerteten ähnlichen Tagen), danach Stufe 4

### Batterie-Vorschlag v2 einspielen und prüfen (01.11.)
- [ ] SQL `13_batterie_vorschlag.sql`, `supabase functions deploy ai-parameter-advisor` (vor 21:00)
- [ ] 21:00 Vorschlag im Tab KI prüfen (Begründung lesen) und übernehmen
- [ ] 02.11.: Protokoll › Energie/Ereignisse, 03.11. Nacht-Protokoll – reicht die Batterie bis morgens?

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
- [x] entfällt: Cron `ai-parameter-advisor-15min` mit SQL 21 abgeschaltet (04.11.)
- [ ] ~~Vor dem Insert prüfen, ob für Parameter + Raum schon ein offener Vorschlag existiert → aktualisieren statt neu anlegen (Frontend zählt seit 26.10. nur den neuesten)~~

### Analyse-Vorschläge (seit 26.10.)
- [ ] Nach einigen Tagen echter Heizdaten prüfen, ob die Regeln zu oft/zu selten auslösen
- [ ] Optional: Whitelist-Eintrag `parallel_heating_capacity` abschalten (SQL in `doc/NEUE-TAB-STRUKTUR-2026-10-26.md` §4)

### Heizzyklen (Trigger seit 26.10.)
- [x] Trigger `trg_log_room_heating_transition` schreibt `heating_start/stop` (`doc/FIX-HEIZZYKLEN-TRIGGER-2026-10-26.md`)
- [ ] Nach 1–2 Tagen: Zyklen prüfen, dann entscheiden, ob `solar_limit_stop` weiter als Heizenergie zählt (Doppelzählung)
- [ ] Block A2 (direkter Insert) im lokalen Dienst entfernen; Dienst-Ordner auf v1.3 bringen

### Alarm-Mails (08.11., `FIX-ALERT-MAILS-2026-11-08.md`)
- [ ] `system-alert` hochladen/deployen, **danach** SQL `27_alert_mails.sql`
- [ ] Erwartet: eine Mail „Problem: Thermostat Büro …“ mit Lösungsansatz, keine „gelöst“-Mail; nach Behebung genau eine „gelöst“-Mail
- [ ] Büro-Thermostat vor Ort prüfen (seit 07.11. 16:48 nicht erreichbar)

### Lokal-Modus: Erreichbarkeit nur nach echter Lesung (08.11., `FIX-LOKAL-ERREICHBARKEIT-2026-11-08.md`)
- [x] `pv-automation`, `auto-resolve-api-errors`, App-Banner angepasst (PR)
- [ ] Nach dem Deploy: Büro-Fehler bleibt **ein** offener Eintrag (kein neuer alle 2 h); Banner zeigt Büro dauerhaft
- [ ] Wenn das Büro wieder antwortet: Fehler in ≤ 10 min geschlossen, genau eine „gelöst“-Mail
- [ ] Offen: toter Raum geht mit letzten Messwerten in die Leistungsgrenze ein – bewusst so gelassen, bei Bedarf Konzept
- [ ] Offen: 65 % der Heizzyklen (7 Tage) < 6 min – echtes Takten oder Abtast-Effekt (Lesung alle 5 min)? Erst klären, dann entscheiden

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
