# Konzept: Eco als Ziel und Raummodell (Auskühlen je Raum)

**Stand:** 2. November 2026 · **Status:** FREIGEGEBEN (Uli, 02.11.2026: „Wir machen alle 3“) – umgesetzt
**Supabase:** `pflnniklvqbwjwrjswaz` · **SQL:** `17_eco_ziel.sql`, `18_raummodell.sql`
**Betrifft:** `pv-automation`, `fetch-weather`, Tagesnote (`tag_bewerten`), App › Protokoll › Raummodell
**Baut auf:** `KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`, `KONZEPT-LERNSCHLEIFE-2026-11-01.md`

---

## 1. Anlass

Am Morgen des 02.11.2026 lag Zimmer Uli bei 20 °C, obwohl Eco 22 °C eingestellt war. Ursache war keine Störung,
sondern die Regel vom 01.11.: Batterie unter 75 % → Batterie-Schutz ohne Ausnahme → Sollwert „Untergrenze − 1 °C“,
Notfall-Heizen höchstens 1000 W. Im November ist die Batterie morgens fast immer unter 75 %, also lief der ganze
Vormittag im Batterie-Schutz.

Uli dazu (02.11.2026):
- „Wir können nicht nur auf PV bauen. Wenn PV da ist, soll sie zu 100 % genutzt werden.“
- „Eco ist das Ziel.“
- „Fester Tarif.“
- „Wir haben Tage ohne viel PV und mit viel PV, Winter und Sommer. Das Haus kühlt unterschiedlich aus.
  Das muss berücksichtigt werden. Die KI sollte lernen und es schon wissen.“

## 2. Grundgedanke

Die Grundlast im Haus ist praktisch null, Strom verbraucht fast nur die Heizung. Der Tarif ist fest.
Daraus folgt: **Ob die Batterie tagsüber oder nachts in die Heizung geht, ändert den Netzbezug nicht.**
An einem Tag ohne genug PV wird die Batterie ohnehin nicht wieder voll – die Sperre spart dort keinen Strom,
sie macht nur die Räume kalt. Schlimmer: Bleibt die Batterie voll und am nächsten Tag scheint die Sonne,
kann sie die PV nicht aufnehmen, und die geht ins Netz.

Der Batterie-Schutz hat deshalb nur einen Zweck: **Sonne zuerst in die Batterie, an Tagen, an denen danach
noch Überschuss für die Räume kommt.**

## 3. Stufe 1 – Regel: Eco ist das Ziel (umgesetzt)

### 3.1 Tagesart
Bei jedem Lauf (`pv-automation`, Abschnitt „TAGESART“) vor dem Batterie-Schutz:

```
Überschuss für Räume = Rest-PV-Prognose (korrigiert) − Grundlast − was die Batterie bis voll noch aufnimmt
Verhältnis           = Überschuss für Räume / Eco-Bedarf aller Räume
Sonnentag            = Verhältnis ≥ Schwelle (1,0 ± KI-Mustergedächtnis, 0,5–1,5)
```
Neu ist der Abzug „Batterie bis voll“ (vorher nicht abgezogen – ein trüber Wintertag mit leerer Batterie galt
leicht als Wartetag). Nach Sonnenuntergang ist kein Überschuss mehr zu erwarten → kein Sonnentag.

| Tagesart | Batterie-Schutz | Räume ohne PV-Budget |
|---|---|---|
| **Sonnentag** | ja, unter `heating_min_battery_soc` (75 %) | Untergrenze halten, auf Überschuss warten; Überschuss → Eco → Komfort |
| **Schlechter Tag** | **nein** | **Eco nach Priorität aus Batterie/Netz**, Summe ≤ `max_grid_heating_power_w` |
| **Nach Sonnenuntergang** | **nein** | Eco nach Priorität (wie schlechter Tag) |
| **Nacht** | – | Nachtwert, **mindestens Untergrenze** (Modus „Nachtwert halten“) |

Bei Abwesenheit (Kalender) bleibt es beim Wartetag (Untergrenze), PV lädt bis Komfort.

### 3.2 Untergrenze ist hart
- `battery_gate_floor_delta` = 0 (vorher 1,0 °C): auch im Batterie-Schutz wird bis zur Untergrenze geheizt.
- ~~Seit 05.11.2026: auch dann, wenn die Notfall-Grenze (`battery_gate_max_power_w`) oder die Netzgrenze schon voll ist – die Untergrenze geht vor (`FIX-UNTERGRENZE-HART-2026-11-05.md`).~~
- **Seit 06.11.2026 (Uli: „Grenze gilt immer“):** wieder unter der Grenze; ein Raum, der allein größer ist, heizt allein; Wartezeit-Vorrang nach `cap_wait_boost_min` (`FIX-HEIZLEISTUNG-2026-11-06.md`).
- Nachtmodus „Nachtwert halten“: Ziel = max(Nachtwert, Untergrenze). Nur „Frostschutz“ ist eine bewusste Ausnahme.

### 3.3 PV zu 100 %
Unverändert: Jede echte Einspeisung geht in die Räume (Eco, dann Komfort, Estrich als Speicher), auch bei Abwesenheit.
Reihenfolge der Lasten regelt der Smartfox (Batterie, dann Auto/Warmwasser). Neu ist nur die Reihenfolge der Räume
in der Komfort-Runde (Stufe 3).

### 3.4 Tagesnote nach den neuen Zielen
| Teil | vorher | seit 02.11.2026 |
|---|---|---|
| ① Nacht | Batterie hat bis morgens gereicht | **Räume nachts über ihrer Untergrenze** (Raum-Minuten darunter, Nacht dieses Tages) |
| ② Sonne | PV im Haus genutzt | unverändert |
| ③ Komfort | Raum-Minuten unter Untergrenze | **Raum-Minuten unter Eco** (Toleranz 0,3 °C), 08–22 Uhr |
| ④ Netz | jede kWh Heizung aus dem Netz | **nur Netzbezug in Stunden mit gleichzeitiger Einspeisung** (2 kWh = 0 Punkte) |

Netzstrom an einem dunklen Tag ist bei festem Tarif kein Fehler mehr. Würde die KI nach der alten Note lernen,
lernte sie, Räume kalt zu lassen. Neue Spalten: `raum_min_unter_eco`, `nacht_min_unter`, `netz_bei_einspeisung_kwh`.

## 4. Stufe 2 – Raummodell: wie schnell kühlt jeder Raum aus? (umgesetzt)

### 4.1 Physik
Ohne Heizen nähert sich ein Raum der Außentemperatur (Newton):

```
T(t) = T_außen + (T_start − T_außen) · e^(−k·t)
k    = ln((T_abends − T_außen) / (T_morgens − T_außen)) / Stunden      [1/h]
```
`k` ist eine Eigenschaft des Raums (Estrich, Fenster, Lage). Winter und Sommer unterscheiden sich nur in
`T_außen` – deshalb gilt ein einmal gelerntes `k` für jede Jahreszeit, und jede Nacht macht es genauer.

### 4.2 Daten
- **Außentemperatur:** `weather_data` hatte erst ab 23.10.2026 Werte. Nachtrag aus dem Open-Meteo-Archiv
  (kostenlos, gemessene Stundenwerte) über `fetch-weather` mit `{"backfill_from": "JJJJ-MM-TT"}`;
  vorhandene Zeilen bleiben unverändert. Gleiche Zeitkonvention wie bisher (Wiener Ortszeit als UTC).
- **Raumtemperaturen:** `room_temperature_samples` (alle vorhandenen Monate).
- **Nur Nächte ohne Heizen:** erkannt über `is_heating` (zuverlässig seit Dienst v1.3, 24.10.2026),
  `heating_start` in `room_heating_logs`, oder Temperaturanstieg > 0,3 °C über den bisherigen Nacht-Tiefstwert
  (funktioniert auch bei alten Daten aus der Zeit des Thermostat-Wochenprogramms).
- Weitere Ausschlüsse: zu wenige Messwerte, Nacht < 6 h, Abstand zur Außentemperatur < 3 °C, kein Abfall.

### 4.3 Tabellen und Ablauf (SQL 18)
| Objekt | Inhalt |
|---|---|
| `raum_abkuehlung` | je Raum und Nacht: T abends/morgens, außen, Stunden, k, geheizt, gültig, Grund |
| `raum_abkuehlung_nacht(datum)` | rechnet eine Nacht für alle Räume |
| `raum_modell_neu_berechnen(von, bis)` | mehrere Nächte (App ruft in 7-Nächte-Blöcken) |
| View `raum_modell` | je Raum: gültige Nächte, k (Median), k vorsichtig (75 %), Außentemperatur-Spanne (letzte 120 Nächte) |
| Cron `nacht-protokoll` | 09:55 zusätzlich die letzte Nacht berechnen |

### 4.4 Anzeige
App › Protokoll › **Raummodell**: je Raum Nächte, k, „so viel kühlt er in 10 h ab Eco aus bei 0 °C / −10 °C“,
aktuelle Temperatur, „abends nötig“, „morgen ohne Heizen“. Zeile antippen → einzelne Nächte mit Begründung.
Knopf **„Außentemperaturen nachtragen und neu berechnen“** erledigt Stufe 2 komplett (kein Skript nötig).

## 5. Stufe 3 – Vorausschau in der Steuerung (umgesetzt)

`pv-automation` (Abschnitt „RAUMMODELL / VORAUSSCHAU“) bei jedem Lauf am Tag:
1. Außentemperatur-Prognose für die kommende Nacht (`weather_data`, Nachtbeginn bis Tagesstart).
2. Je Raum mit Modell (≥ 3 gültige Nächte, `k_vorsichtig`):
   - **abends nötig** = T_außen + (Eco − T_außen) · e^(k·h_Nacht) – so warm muss der Raum bei Nachtbeginn sein,
     damit er morgens ohne Heizen noch Eco hat
   - **morgen ohne Heizen** = T_außen + (T_jetzt − T_außen) · e^(−k·h_bis_Morgen)
   - **Nachtbedarf** = abends nötig − T_jetzt
3. **Wirkung:** Bei gleicher Priorität (und ohne KI-Tagesplan-Rang) kommt der Raum mit dem größten Nachtbedarf
   zuerst – in der Eco- und vor allem in der Komfort-Runde. Die PV-Wärme landet im Estrich der Räume, die sie heute
   Nacht am meisten brauchen. Priorität bleibt vorne.
4. Ergebnis in `system_settings.raum_vorausschau` (Anzeige im Protokoll).

Vorsichtig gerechnet (75-%-Quantil von k): lieber zu schnelles Auskühlen annehmen als zu langsames.

## 6. Was die KI damit kann – und was nicht

- Die Regeln aus §3 gelten immer; die KI hebt sie nicht auf (`LOCKED_PARAMS` bleiben).
- Neu für die KI: eine **gelernte Größe je Raum**, die mit jeder Nacht besser wird, und eine Tagesnote, die an
  Ulis Zielen misst. Damit kann Stufe 3 der Lernschleife (Vorschläge aus ähnlichen Tagen) jetzt auch Außentemperatur
  und Auskühlen vergleichen.
- Nicht im Modell: Sonneneinstrahlung durch Fenster tagsüber, Nachwärme des Estrichs nach dem Heizen. Deshalb
  nur Nächte, nur „ohne Heizen“, und vorsichtiges k.

## 7. Einspielen

1. SQL `17_eco_ziel.sql` im SQL-Editor ausführen (Notfall-Abstand 0, Tagesnote neu, Noten neu gerechnet).
2. SQL `18_raummodell.sql` ausführen (Tabellen, Funktionen, View, Cron-Takt).
3. Österreich-PC: `git pull`, dann `supabase functions deploy pv-automation` und `supabase functions deploy fetch-weather`.
4. App (Vercel deployt automatisch): Protokoll › Raummodell › „Außentemperaturen nachtragen und neu berechnen“.

## 8. Prüfen

- Heute/morgen (trüb): Logs `[TAGESART] schlechter Tag`, `[SOC-GATE] offen`, Räume ohne Budget auf Eco
  (`[TAGESMODUS] grid`), höchstens `max_grid_heating_power_w` gleichzeitig.
- Raummodell: Sind die k-Werte plausibel (Bad/Flur schneller als Wohnräume)? Passt „−10 h bei 0 °C“ zu Ulis Erfahrung?
- Morgen 09:55: Tagesnote 02.11. nach neuem Maßstab; „morgen ohne Heizen“ von heute gegen gemessene Morgentemperatur.
- Zu beobachten: Reichen 2000 W `max_grid_heating_power_w` im Winter, damit alle Räume Eco erreichen?
  Sonst unter Einstellungen › Haus anheben (fester Tarif – kein Kostennachteil).
