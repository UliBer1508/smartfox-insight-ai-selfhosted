# Fix: Kontrolle über die Heizleistung (06.11.2026)

**Betrifft:** `rooms.heating_power_w` (Daten), `supabase/functions/pv-automation/index.ts`,
neue Edge Function `measure-room-power`, `analysis-scheduler`, SQL `24_heizleistung_messung.sql`,
App: `src/components/overview/HeatingNow.tsx` (neu), `HouseOverview.tsx`, `HouseSettingsCard.tsx`

## Anlass
Uli, 06.11.2026 morgens: „Wir haben keine Kontrolle über den Stromverbrauch für die Heizung. 3 kW Verbrauch,
und nur 2 kleine Zimmer zeigen, dass geheizt wird. Gestern den Verbrauch im Wohnzimmer komplett falsch
eingeschätzt. Wir brauchen mehr Kontrolle und klare Aussagen, ob geheizt wird und wie viel.“

## Befund

### 1. Die Raumleistungen waren geschätzt – und zum Teil weit daneben
Gemessen über 13 Tage (24.10.–06.11.2026), nur Fronius-Messwerte **ohne PV** (dann laufen Warmwasser
und Auto nicht): Hausverbrauch ≈ Grundlast + Σ (Raum heizt × Raumleistung), lineare Regression,
Ausreißer (> max(600 W, 3σ)) in drei Durchläufen entfernt. 2.293 Messwerte, 2.205 genutzt,
mittlere Abweichung **73 W**, Grundlast **~240 W**.

| Raum | eingestellt bisher | gemessen | volle Messwerte |
|---|---|---|---|
| Wohnzimmer | 5500 (bis 05.11. 18:30: 2400) | **5560 W** | 157 |
| Wirtschaftsraum | 700 | **2050 W** | 79 |
| Zimmer Uli | 1200 | ~1950 W | 5 (unsicher) |
| Zimmer Luis | 1000 | **1240 W** | 109 |
| Zimmer Luca | 1000 | **1180 W** | 37 |
| Bad Uli | 600 | **865 W** | 148 |
| Büro | 900 | **840 W** | 101 |
| Haustür | leer (Code: 800 W) | **~410 W** | 95 |
| Toilette Eingang | leer (Code: 800 W) | **~100 W** | 167 |
| Flur, Kinder Bad, Waschraum | 700 / 500 / 600 | – | heizen praktisch nie (innenliegend, ohne Fenster) |

Die „2 kleinen Zimmer“ am 06.11. 07:10–07:25 waren Wirtschaftsraum (2050 W) und Haustür (~450 W):
zusammen mit der Grundlast genau die gemessenen 2,7–3,1 kW. Der Wirtschaftsraum ist klein, zieht aber
so viel wie zwei Kinderzimmer.

Toilette Eingang meldet oft „heizt“, der Verbrauch steigt dabei aber kaum (~100 W) – offen, ob an diesem
Thermostat überhaupt eine Heizung hängt.

### 2. Die automatische Leistungsmessung lief nie
`calculate-heating-power` und die Spalte `rooms.calculated_power_w` existieren, die Steuerung bevorzugt sie
sogar (`calculated_power_w || heating_power_w || 800`). Es gab aber keinen Cron-Job; alle Felder waren leer.

### 3. Die Leistungsgrenze wurde nicht eingehalten
- **Tag, 05.11. 15:15–18:15:** Wohnzimmer (~5,5 kW) unter der Untergrenze → heizte trotz Grenze 4000 W
  („Untergrenze ist hart“, `FIX-UNTERGRENZE-HART-2026-11-05.md`). Batterie 98 → 5 %, danach bis 8,7 kW Netz.
  Protokoll selbst: „Netz 8300/4000 W“.
- **Nacht 03./04.11.:** „Nachtwert halten“ setzte um 20:23 alle Räume **einmal** auf ihre Nachtwerte und
  schwieg dann bis zum Morgen (Quiet Mode). Nachts gab es **keine** Leistungsgrenze → 7–11 kW die ganze Nacht.

### 4. Unbekannter Verbraucher um 6 Uhr
Jeden Morgen ~1,5 kW für 10–15 min ohne „heizt“-Meldung: werktags 06:05, am Wochenende 05:05 – nach
Wochentag, nicht nach Zeitumstellung (Zeitstempel geprüft: DB-Zeit, PV-Start passt zum Sonnenaufgang).
Laut Uli wahrscheinlich die Espressomaschine (Zeitschaltung). Die Messung filtert solche Ausreißer heraus.

### 5. Thermostate heizen über den Sollwert
Bekannt seit 01.11. (DP 19 = −1,0 °C): Zimmer Luis stoppte bei 22,1 °C (Soll 21), Wirtschaftsraum bei 20,0 °C
(Soll 19). Kostet Strom; nicht Teil dieses Fixes.

## Entscheidungen (Uli, 06.11.2026)
- „Wir machen alle 4 Punkte“.
- Punkt 4: **„Grenze gilt immer“** – Untergrenze geht vor, aber die Summe bleibt unter der Grenze. Ausnahme:
  Ein Raum, der allein größer ist als die Grenze, heizt allein.

## Änderungen

### Punkt 1 – Raumleistungen auf Messwerte (06.11.2026 08:40, per SQL)
Wohnzimmer 5550, Wirtschaftsraum 2050, Zimmer Uli 2000, Zimmer Luis 1250, Zimmer Luca 1200, Bad Uli 850,
Büro 850, Haustür 450, Toilette Eingang 100 W. Flur, Kinder Bad, Waschraum unverändert.
Hinweis: Der Trigger `protect_rooms_sensitive_columns` setzt `heating_power_w` für anonyme Zugriffe zurück;
SQL ohne Anmeldung braucht `set_config('request.jwt.claims','{"role":"service_role"}', true)` in der Transaktion.

### Punkt 2 – Leistungsmessung automatisch
- SQL 24: Tabelle `raum_leistung_messung`, Funktion `raum_leistung_daten(tage)` (ein JSON-Wert, damit keine
  1000-Zeilen-Grenze), Whitelist `heating_power_w` (room, 50–8000 W, Stufe „suggest“).
- Edge Function `measure-room-power`: täglich **09:30** über `analysis-scheduler` (14 Tage). Schreibt je Raum
  Watt, Messpunkte, Sicherheit (hoch ≥ 60, mittel ≥ 30 volle Messwerte) und die Grundlast.
- Vorschlag in **KI › Zu entscheiden**, wenn Sicherheit mindestens mittel und Abweichung ≥ 150 W und ≥ 15 %
  (gerundet auf 50 W). Kein neuer Vorschlag, solange einer offen ist; abgelehnt → 14 Tage Ruhe bei ähnlichem Wert.
  **Die Messung ändert nichts selbst** – Uli genehmigt.
- Test: `POST measure-room-power?dry=1` rechnet nur. `analysis-scheduler?force=measure_room_power` startet sofort.

### Punkt 3 – Live-Anzeige (Übersicht)
- Neue Karte **„Heizung jetzt“**: *gemessen* (Hausverbrauch − gemessene Grundlast), *laut Thermostaten*
  (Σ Raumleistung der Räume mit „heizt“), *Grenze* (Tag: `heating_day_mode`, Nacht: `heating_night_mode`).
  Weichen gemessen und Thermostate um > 500 W ab, sagt die Karte, was es bedeuten kann (anderes Gerät,
  Thermostat meldet nicht, Leistung zu hoch eingestellt). Dazu heizende Räume mit „seit“ und kWh heute.
- Raumkarte: bei „heizt“ die Leistung statt „ja“, „seit HH:MM“, Zeile „Heute geheizt … · … kWh · Leistung …“.
  „Automatik: …“ jetzt auch nachts.
- SQL `raum_heizung_heute()`: je Raum heizt seit, Heizminuten und kWh heute (Heizzeit × Raumleistung).

### Punkt 4 – Grenze gilt immer (`pv-automation`)
- Gemeinsame reine Funktion `allocateUnderCap`: Kandidaten nach **Wartezeit-Vorrang**, dann Priorität;
  Raum bekommt Leistung, solange `belegt + Raumleistung ≤ Grenze`; ist noch **nichts** belegt, darf ein Raum
  über der Grenze **allein** heizen. Andere warten mit `holdBelow` = abgerundet Ist − 0,5 °C.
- **Wartezeit-Vorrang:** Wer länger als `heating_settings.cap_wait_boost_min` (Standard 60 min, Einstellungen ›
  Haus › Verteilung „Wartezeit bis Vorrang“) wartet, kommt zuerst dran – sonst käme das Wohnzimmer
  (Priorität 7, 5,5 kW) nie zum Zug. Zustand in `system_settings.cap_wait_state`.
- **Nachlauf zählt mit:** Räume, die noch heizen, obwohl sie schon über ihrem Ziel sind, belegen Leistung.
- **Tag** (`allocateDayTargets`): Pass 1 (unter Untergrenze) wieder unter der Grenze; ein Raum, der allein
  über der Grenze heizt, nur bis Untergrenze, nicht bis Eco. Grenze = `max_grid_heating_power_w`
  (Batterie-Schutz: `battery_gate_max_power_w`).
- **Nacht** (`maintain`): kein einmaliger Push + Quiet Mode mehr, sondern bei jedem Lauf (5 min) Verteilung unter
  `max_grid_heating_power_w`; Ziel je Raum = max(Nachtwert, Untergrenze). Manuell übersteuerte Räume, die heizen,
  zählen mit und werden nicht verändert. Räume mit ausgeschalteter Automatik bleiben unberührt (vorher bekamen
  sie nachts den Nachtwert). Begründung je Raum in `system_settings.heating_night_mode`.
  `frost_only` unverändert.
- Durchgespielt: Nacht 03./04.11. → 2,6 kW statt 7–11 kW (Wohnzimmer und Wirtschaftsraum warten, nach 60 min
  zuerst dran). Batterie-Schutz 1000 W: Fast jeder Raum ist allein größer → dort heizt immer nur ein Raum.

## Einspielen
1. SQL 24 – am 06.11.2026 bereits ausgeführt.
2. PR mergen → GitHub-Aktion deployt `pv-automation`, `measure-room-power`, `analysis-scheduler`; Vercel die App.
3. Prüfen: Übersicht › „Heizung jetzt“; heute Abend nach Nachtbeginn Raumkarten „Automatik: …“; morgen 09:30
   `raum_leistung_messung`.

## Offen
- Toilette Eingang: hängt eine Heizung am Thermostat?
- Zimmer Uli: nur 5 volle Messwerte – die nächtliche Messung bestätigt oder korrigiert den Wert.
- Überschwingen der Thermostate (+0,6–1,0 °C, DP 19) – eigener Fix.
