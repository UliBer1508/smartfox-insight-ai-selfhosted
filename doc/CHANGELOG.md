# Changelog

Alle wichtigen Änderungen am Projekt werden hier dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [2.28.0] - 2026-11-13

### Changed
- Einstellungen › Datensicherung zeigt **beide Sicherungs-PCs** (wie Heizung München, `Datensicherung.jsx`):
  PC München „sichert jede Nacht“, PC Österreich „Ersatz – sichert nur, wenn nötig“, je PC letzter Lauf
  (auch „Übersprungen“ aus `system_settings.backup_standby`), letzte gelungene Sicherung, Größe, Uhrzeit, Ordner.
  Verlauf 14 Tage mit Rechner je Lauf. Gelbe Warnung, wenn München ausfällt (Österreich eingesprungen)
  oder der Ersatz sich nicht meldet. Texte „PN40“ ersetzt.

## [2.27.0] - 2026-11-12

### Removed (`doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md`, Stufe 2a)
- `pv-automation`: Zuschläge des Mustergedächtnisses (Tagesart-Schwelle, Pre-Heat-Signal, Wochen-Hinweis mit falscher
  Eigenverbrauchsquote 3,4 %, Pattern-Recall-Bonus). Einstellungen › KI: Regler „Stärke“ entfernt.

### Fixed
- SQL 36 ausgeführt: Grundgebühr 161,30 €/Jahr, `energie_tag` nachgerechnet.

## [2.26.0] - 2026-11-12

### Added (`doc/VERLAUF-UND-WIRKUNG-2026-11-12.md`)
- Neuer erster Tab **Auto-Steuerung** (Startseite): Modus und Eingriffe, Plan (umgezogen aus KI), Verlauf und Wirkung.
- Verlauf Tag/Woche/Monat/Jahr mit Vergleich Vorperiode/Vorjahr, Netzkosten, Batterie, Haus unter Eco,
  KI-Vorschläge als Marken im Zeitstrahl und ihre Wirkung (3 Tage vorher/nachher).
- SQL 35: dauerhafte Ablage `energie_stunde` / `energie_tag` (nie gelöscht), stündlich gefüllt, nachgetragen ab 13.10.2026.

### Changed
- Auto-Steuerung: Reihenfolge Verlauf und Wirkung · Steuerung · Plan. Alle Abschnitte in Auto-Steuerung, KI und Analyse klappbar.
- Analyse › Tag ohne Doppeltes: Kacheln, PV-Verlauf, Kosten und Zeitraum-Umschalter entfernt (stehen in Auto-Steuerung › Verlauf).
- SQL 36 + `fetch-energy-prices`: Grundgebühr 161,30 €/Jahr lt. Jahresabrechnung (Messentgelt fehlte).
- Doppelte entfernt: Planer-Einstellungen in Einstellungen › Haus (nur noch Auto-Steuerung), Protokoll › Raummodell (jetzt im Plan).
- Analyse › Woche/Monat/Jahr verweisen auf den Verlauf (alte Grafiken rechneten mit um Faktor 10 falschen Tageswerten).

## [2.25.0] - 2026-11-12

### Removed (`doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md`, Stufe 1)
- Doppelte Teile ohne Wirkung auf die Steuerung durch die neuere Variante ersetzt:
  KI-Tagesplaner (`ai-daily-planner`) und gelernte Policies (`update-learned-policies`) → Heizplaner;
  Nacht-Raummodell (`raum_abkuehlung`) → Heizmodell (Vorausschau in `pv-automation`, Protokoll › Raummodell);
  `monitor-solar-heating`, `analyze-solar-gain` → Heizmodell + „Fühler in der Sonne“; `calculate-heating-power` → `measure-room-power`.
- App: KI › „KI-Tagesplan“, „ML-Folgerate“, Einstellungen › Räume „Solar-Analyse“ entfernt.
- SQL 34: Zeitpläne der ersetzten Functions entfernt, Nacht-Protokoll ohne altes Raummodell. Keine Daten gelöscht.

### Documented
- Liste aller doppelten Teile mit Wirkung, Stufe 2 (PV-Prognose, Energiebedarf, Mustergedächtnis, Bewertung) zur Entscheidung.
- Arbeitsregel: Ein neues Teil entfernt das alte im selben PR.

## [2.24.0] - 2026-11-10

### Fixed (`doc/PRUEFUNG-REGELN-WECHSELWIRKUNGEN-2026-11-10.md`, `doc/FIX-REGELN-A-B-C-2026-11-10.md`, `doc/FIX-PRUEFUNG-REST-2026-11-10.md`)
- Prüfung aller Regeln und Prozesse auf Wechselwirkungen (pv-automation vollständig, 28 Functions, 30 Cron-Jobs, Trigger, Dienst).
- A: Alter Übertemperatur-Schutz brach im Lokal-Modus vor dem Tagesmodus ab (271× in 24 h) – jetzt entscheidet der Tagesmodus;
  Eco-Pass schaltet am Ziel ab.
- B/B2: Blockade der Leistungsgrenze durch Vorrang-Reservierung + Nachlauf (10.11. ab 13:00: 100/4000 W, 6 Räume unter
  Untergrenze). Allein heizen trotz Nachlauf nur für Räume über der Grenze, die schon heizen oder lange warten.
- C: Wirkungsprüfung „nicht steuerbar“ (SQL 30) – Kinder Bad nahm seit ≥ 01.11. keinen Befehl an (1727 Befehle ohne Wirkung).
  Markierte Räume bekommen nur einen Prüfbefehl pro Stunde; Hinweis auf der Raumkarte.
- K4: Lern-Ereignisse zeigen, wer das Ziel wirklich bestimmt hat (`entschieden_von`); Kinder-Bad-Lerndaten ausgeschlossen (SQL 32).
- K7: höchstens ein `pv-automation`-Lauf pro 60 s (SQL 33).
- PV-Budget zieht Netzbezug ab (27 % der PV-Messungen hatten gleichzeitig im Mittel 1,5 kW Bezug).
- Gemessene Raumleistung (`heating_power_w`) vor `calculated_power_w`; undefinierte Variable `heatingSettings` behoben.

### Added
- `local-collector/tuya-thermostat/thermostat-selbsttest.js` + SQL 31: prüft jedes Thermostat (Netz, Protokoll, Datenpunkte,
  Schreiben Ton/Soll/Soll+Modus). Ergebnis 10.11.: 10 Geräte gleich (v3.5), Kinder Bad schreibt nicht, Büro offline.

## [2.23.0] - 2026-11-09

### Fixed (`doc/FIX-VORRANG-UND-SCHALTBAND-2026-11-09.md`)
- Vorrang hielt nur einen Lauf: Wer Leistung hat und heizt, behält sie bis zum Ziel (höchstens `cap_keep_max_min`,
  120 min); ein wartender Raum mit Vorrang (Wohnzimmer) reserviert die Grenze, bis er allein heizen kann.
- Schaltband der Thermostate (Soll ± DP 101, eingestellt 1,0 °C): „wartet“ = Ist − Band − 0,5 °C (schaltet wirklich ab),
  Anstoß für zugeteilte Räume im Band, Abschalten bei Ziel + `ziel_abschalt_ueber_c` (0,3 °C) statt Ziel + 1,0 °C.
  Anstoß/Abschalten nur im Lokal-Modus.
- DP 101 Wohnzimmer 1,0 → 0,5 °C (Test).

### Added
- SQL 29 (`cap_keep_max_min`, `ziel_abschalt_ueber_c`), Einstellungen › Haus › Verteilung.

## [2.22.0] - 2026-11-09

### Fixed (`doc/FIX-FUEHLER-SONNE-UND-DP19-2026-11-09.md`)
- Sonne auf dem Fühler (Wohnzimmer, sonnige Vormittage, bis 32,4 °C gemeldet): Trigger `a_trg_fuehler_plausibel` erkennt
  Sprünge (≥ 2,0 °C je Lesung / ≥ 3,0 °C in 15 min), hält bis zum Ende den letzten plausiblen Wert; Gerätewert in
  `rooms.current_temp_gemeldet` bzw. `room_temperature_samples.temperature_gemeldet`. `pv-automation` lässt den Raum
  so lange aus (kein Budget, kein Anteil an der Grenze, kein Befehl). SQL 28.
- DP 19 (−1,0 → 0 am 06.11., Büro 01.11.) verschiebt die gemeldete Temperatur um +1,0 °C: Messwerte davor
  nachkorrigiert (`fuehler_korrektur`, umkehrbar). Annahme vom 01.11. widerlegt.

### Added
- Einstellungen › Haus › Thermostat-Fühler (an/aus, Schwellen, Höchstdauer). Raumkarte: Hinweis „Fühler in der Sonne“.

## [2.21.0] - 2026-11-07

### Changed (`doc/FIX-KOMFORT-IST-MAXIMUM-2026-11-07.md`)
- Komfort ist das Maximum: Wert „Estrich laden bis“ (`pv_boost_max_temp`) abgeschafft – `pv-automation` hält Komfort bei voller Batterie nur noch, wenn alle Räume auf Komfort sind; Heizplaner deckelt bei Komfort; Tagesanalyse-Regel 3 entfernt; App-Hinweise angepasst; SQL 26 (Whitelist aus).

### Fixed
- KI › Zu entscheiden: Grenzen für Raumwerte aus den aktuellen Raumwerten (Vorschlag ließ sich nach Änderung von Komfort nicht übernehmen).

## [2.20.0] - 2026-11-06

### Added (Heizplaner, `doc/KONZEPT-PLANER-2026-11-06.md`)
- Edge Function `heizplaner` (Schattenbetrieb): 24-h-Plan alle 15 min, minimiert Netzstrom bei Komfortzielen; lernt nachts Raummodell (Auskühlen, Aufheizen, Sonne, innere Wärme) und PV-Vorhersage (inkl. Bergschatten), rechnet den Vortag gegen.
- SQL `25_heizplaner.sql`: `heizmodell`, `heizplan`, `heizplan_vergleich`, `heizplaner_daten()`, Einstellungen `planer_*`.
- App: KI › 2 „Planer“ (Plan 24 h, Jetzt Planer vs. Steuerung, Zeitleiste je Raum, Gegenrechnung, Modell je Raum); Einstellungen › Haus › Verteilung: Planer-Modus und Gewichte.
- `analysis-scheduler`: Planer bei jedem Lauf, Lernen + Gegenrechnung 03:00.

## [2.19.0] - 2026-11-06

### Fixed (`doc/FIX-HEIZLEISTUNG-2026-11-06.md`)
- Raumleistungen auf gemessene Werte gesetzt (Wirtschaftsraum 700 → 2050 W, Haustür/Toilette eingetragen u. a.).
- `pv-automation`: Leistungsgrenze gilt immer – tagsüber auch für Räume unter der Untergrenze, nachts bei jedem Lauf (vorher einmaliger Push ohne Grenze, 7–11 kW). Ein Raum über der Grenze heizt allein und nur bis Untergrenze; Wartezeit-Vorrang (`cap_wait_boost_min`, 60 min); Nachlauf zählt mit.

### Added
- Edge Function `measure-room-power` (täglich 09:30): misst die Heizleistung je Raum, Vorschläge in KI › Zu entscheiden.
- SQL `24_heizleistung_messung.sql`: `raum_leistung_messung`, `raum_leistung_daten()`, `raum_heizung_heute()`, Whitelist `heating_power_w`, `heating_settings.cap_wait_boost_min`.
- Übersicht: Karte „Heizung jetzt“ (gemessen vs. laut Thermostaten, Grenze, kWh heute); Raumkarte mit Leistung, „seit“, „heute“, Automatik-Begründung auch nachts.
- Einstellungen › Haus › Verteilung: „Wartezeit bis Vorrang“.

## [2.18.2] - 2026-11-05

### Fixed (`doc/FIX-UNTERGRENZE-HART-2026-11-05.md`)
- `pv-automation`: Räume unter der Untergrenze werden immer bis zur Untergrenze geheizt, auch wenn die Leistungsgrenze (Batterie-Schutz 1000 W bzw. Heizleistung ohne Sonne) schon voll ist. Vorher bekam ein solcher Raum „Ist − 0,5 °C“ und kühlte beliebig aus (Zimmer Uli am 05.11.: Soll 20,0 °C bei Untergrenze 21 °C).

### Changed
- Übersicht › Raumkarte: Zeile „Automatik: …“ mit der Begründung des Tagesmodus; Untergrenze steht jetzt in der Wertezeile (Nacht · Untergrenze · Eco · Komfort).

## [2.18.1] - 2026-11-05

### Added
- Systemstatus auch in der App Heizung München; Zeile „Heizung München (Collector)“ in beiden Apps.
- SQL `23_systemstatus_muenchen.sql`: München-Collector in `system_problems()`/`system_cloud_status()`, Anmeldung München als Admin.

### Fixed
- Dienste-Wächter: eigene `package.json` (CommonJS), findet `nssm.exe` selbst (München: nicht im PATH), Install-Skript bricht ab, wenn die Cloud nicht erreichbar ist.

## [2.18.0] - 2026-11-05

### Added (Systemstatus, `doc/SYSTEMSTATUS-2026-11-05.md`)
- Symbol in der Kopfleiste: grün, wenn alles läuft, sonst „1 Problem“. Fenster mit Österreich-PC, München-PC und Cloud; Start/Stop/Neustart für Admins, Fernzugriff (Tailscale, Cloudflare) nur Start.
- Dienste-Wächter (`local-collector/dienste-waechter/`): eigener NSSM-Dienst je PC, findet alle NSSM-Dienste + Tailscale, meldet alle 30 s über eine ausgehende Verbindung und führt Befehle aus – auch wenn Tailscale nicht läuft.
- Edge Functions `system-agent` (Token statt anon-Schlüssel) und `system-alert` (Cron alle 5 min: Webseiten prüfen, Mail bei neuem Problem, „wieder in Ordnung“, Erinnerung nach 24 h).
- SQL `22_systemstatus.sql`: `system_hosts`, `system_services`, `service_commands`, `system_status_admins`, `system_alert_state`, `system_problems()` (eine Liste für App und Mail), `system_cloud_status()`.

## [2.17.1] - 2026-11-04

### Fixed (ki-tagesanalyse, Konzept KI-Vorschläge §9.5)
- Untergrenze nur vorschlagen, wenn der Raum sie morgens gehalten hat; sonst Hinweis „Nicht einmal die Untergrenze gehalten – Ursache prüfen“.
- Greift die Hausgrenze „Heizleistung ohne Sonne“, keine Untergrenzen-Vorschläge; Hauswerte vor Raumwerten.
- Nur Tage nach der letzten genehmigten Änderung desselben Werts zählen.
- Tagesart auch aus der PV-Menge (Sonnentage speisten kaum ein).

## [2.17.0] - 2026-11-04

### Added (KI › Zu entscheiden, `doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md` §9)
- Alle KI-Vorschläge an einem Platz, in einfachen Worten: Rückblick auf gestern, Vorschläge als Frage mit „Was sich ändert / Warum / Was es bringt – und kostet“, Knöpfe Ja · Anderen Wert · Nein, Rückblick nach 3 Tagen mit Rücknahme-Frage, „Zur Info“.
- Edge Function `ki-tagesanalyse` (täglich 10:00 über `analysis-scheduler`): drei Regeln aus 7 Tagen (Untergrenze, Heizleistung ohne Sonne, Estrich laden bis), Wirkungsbericht.
- SQL `21_ki_zu_entscheiden.sql`: Tabellen `ki_vorschlaege`, `ki_tagespaket`, Funktion `ki_raum_tag()`, `battery_soc_suggestions.decided_value`.
- `battery-soc-decision`: eigener Wert („Anderer Wert“, 40–90 %), Rücknahme aus `ki_vorschlaege`, Eintrag für den Wirkungsbericht.

### Changed
- Whitelist nach Konzept §3 (SQL `20_whitelist_nach_konzept.sql`): vorschlagsfähig nur Untergrenze, Estrich laden bis, Heizleistung ohne Sonne (und die Batterie-Grenze über die Batterie-Empfehlung).
- Stündliche Gemini-Vorschläge (`ai-parameter-advisor-15min`) abgeschaltet; alte Liste nur noch als Protokoll unter KI › 3.
- Texte: „Autopilot wendet selbst an / rollt zurück“ entfernt – die KI schlägt nur vor.
- Zähler in Kopfzeile und Übersicht zählen `ki_vorschlaege`.

## [2.16.1] - 2026-11-02

### Changed (KI-Vorschläge, `doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md`)
- `ai-parameter-evaluator`: keine automatische Rücknahme mehr, nur Hinweis im Protokoll (Prüfmodell: Uli entscheidet).
- Alle KI-Parameter auf „suggest“ (SQL `19_ki_nur_vorschlaege.sql`).

### Added
- GitHub-Aktion `deploy-functions.yml`: geänderte Edge Functions werden nach jedem Merge auf `main` deployt.

## [2.16.0] - 2026-11-02

### Changed (Eco als Ziel, `doc/KONZEPT-RAUMMODELL-2026-11-02.md`)
- Batterie-Schutz gilt nur noch an Sonnentagen (Überschuss nach Batterieladung reicht für den Eco-Bedarf). An Tagen ohne genug PV und abends: Eco nach Priorität aus Batterie/Netz.
- Tagesart rechnet „Batterie bis voll“ vom PV-Rest ab.
- Untergrenze hart: Notfall-Abstand 0 °C (SQL 17), Nachtwert mindestens Untergrenze.
- Tagesnote: Komfort an Eco, Nacht an Untergrenze, Netz nur bei gleichzeitiger Einspeisung (SQL 17).

### Added (Raummodell)
- Auskühlen je Raum aus Nächten ohne Heizen (`raum_abkuehlung`, `raum_modell`, SQL 18), täglich 09:55 fortgeschrieben.
- Außentemperatur-Nachtrag aus dem Open-Meteo-Archiv (`fetch-weather`, `backfill_from`).
- Vorausschau in `pv-automation`: „abends nötig“ für Eco am Morgen; gleiche Priorität → größter Nachtbedarf zuerst.
- Protokoll › Raummodell mit Knopf „Außentemperaturen nachtragen und neu berechnen“.

## [2.15.0] - 2026-11-01

### Added (Lernschleife, `doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md`)
- Tagesnote je Tag nach Ulis Zielen (Nacht · Sonne · Komfort · Netz, je 25 Punkte) mit den Einstellungen des Tages: Tabelle `tages_bewertung`, Bewertung 09:55, Tab Protokoll › Tagesnoten, Eintrag im Protokoll.
- Batterie-Vorschlag nennt den bestbewerteten ähnlichen Tag und dessen Grenze (Vorstufe zu Vorschlägen aus Tagesnoten).

### Changed
- KI lernt nur noch aus Daten ab 26.10.2026 (`learning_data_since`); alte `learned_policies` geleert.
- Tagesnote: Teil Komfort war immer 0 (Rechenfehler), korrigiert und Noten 26.–31.10. neu gerechnet (SQL 16).
- Altdaten vor dem 26.10.2026 gelöscht/geleert (SQL `15_altdaten_loeschen.sql`): Lern-Ereignisse, ML-Merkmale, alte Heizprotokolle, Heiz-Kennzahlen im Mustergedächtnis, berechnete Raumwerte.

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
