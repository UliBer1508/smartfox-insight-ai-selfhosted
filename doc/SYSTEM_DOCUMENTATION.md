# 🔴 MASTER-DOKUMENTATION — Energiemanagement-System

> ## ⚠️ PFLICHT FÜR JEDE ÄNDERUNG
> **Bevor du Code änderst, MUSST du dieses Dokument lesen.**
> Das Konzept hier ist die Wahrheit — Code wird daran angepasst, NICHT umgekehrt.
>
> **Workflow bei jeder Änderung:**
> 1. Relevante Sektion in dieser Doku lesen → Konzept verstehen
> 2. Implementieren — bestehende Logik **erweitern, nicht überschreiben**
> 3. Diese Doku aktualisieren (betroffene Sektion + Changelog Sektion 20)
> 4. Bei Konflikt zwischen User-Wunsch und dokumentiertem Konzept → **nachfragen**, nicht überschreiben
>
> ## 🔍 PFLICHT: Nebenwirkungen prüfen, BEVOR implementiert wird (Uli, 08.11.2026)
> Bisher hat fast jede Lösung ein neues Problem erzeugt – jede Änderung war für sich richtig, das Zusammenspiel
> mit dem Bestehenden und das Verhalten über Zeit wurde nicht geprüft (Beispiele: Heizzyklen/RLS 26.10.,
> Batterie-Vorschlag überschrieb Nacht-Reserve 28.10., Nachtwert halten 7–11 kW 03.11., Mail-Pingpong 08.11.).
> Vor jeder Änderung, für **alle** Teile (Code, SQL, Trigger, Cron, Dienst, App):
> 1. **Wer liest und schreibt dieselben Daten?** Jede berührte Tabelle/Spalte/Funktion im ganzen Repo suchen
>    (Edge Functions, SQL-Trigger, Cron-Jobs, lokale Dienste, beide Apps, auch `heizung-muenchen`). Je Stelle:
>    Was passiert dort nach der Änderung? Welche Annahme macht sie über die Daten – stimmt sie wirklich
>    (z. B. „erfolgreich“ = nur eingereiht, `last_thermostat_sync` ≠ echte Lesung)?
> 2. **Verhalten über Zeit.** Mindestens durchspielen: kurzer Aussetzer · Dauerausfall über Stunden · Flackern ·
>    Neustart eines Dienstes · Tag/Nacht-Wechsel · Abwesenheit. Wo treffen zwei Zeitschwellen aufeinander?
> 3. **Mit echten Daten nachrechnen.** Die neue Logik gegen die Daten der letzten Tage laufen lassen (SQL, nur
>    lesend) und das Ergebnis mit dem Ist vergleichen – bevor etwas eingespielt wird.
> 4. **Umstellung selbst prüfen.** Was passiert im Moment des Einspielens (alte Zustände, Reihenfolge Deploy/SQL)?
> 5. Ergebnis als Abschnitt **„Nebenwirkungen geprüft“** in die FIX-/Konzept-Doku. Was bewusst nicht geändert
>    wird, steht mit Grund dort und im TODO.
>
> **Letzte Aktualisierung:** 2026-11-08 · **Version:** 3.6 · **Projekt:** pflnniklvqbwjwrjswaz (vorher Lovable `tvqmhdpcixkfsudxughs`)

---

## Inhalt
1. [Hardware & Topologie](#1-hardware--topologie)
2. [Datenpipeline & Polling](#2-datenpipeline--polling)
3. [Datenbank-Schema (Kernkonzepte)](#3-datenbank-schema-kernkonzepte)
4. [PV-Automation: 4-Stufen-Logik + Tagesmodus](#4-pv-automation-4-stufen-logik)
5. [Eco- vs. Komfort-Budget](#5-eco--vs-komfort-budget)
6. [Batterie-Reserve & Puffer](#6-batterie-reserve--puffer)
7. [Mikro-Budget & Soft-Rotation](#7-mikro-budget--soft-rotation)
8. [Tolerante Deaktivierung](#8-tolerante-deaktivierung)
9. [Nacht- vs. Tagbetrieb](#9-nacht--vs-tagbetrieb)
10. [Tuya-Steuerung & Quota-Schutz](#10-tuya-steuerung--quota-schutz)
11. [Sicherheits-Gates & Ghost-Heating-Prevention](#11-sicherheits-gates--ghost-heating-prevention)
12. [Machine Learning & AI](#12-machine-learning--ai)
13. [PV-Forecast & Wetter](#13-pv-forecast--wetter)
14. [Edge Functions Übersicht](#14-edge-functions-übersicht)
15. [Frontend-Architektur](#15-frontend-architektur)
16. [PWA & Service Worker](#16-pwa--service-worker)
17. [Sicherheit & RLS](#17-sicherheit--rls)
18. [Bekannte Limitierungen](#18-bekannte-limitierungen)
19. [Entscheidungsprotokoll](#19-entscheidungsprotokoll)
20. [Changelog](#20-changelog)

---

## 1. Hardware & Topologie

| Komponente | Spezifikation | Schnittstelle |
|---|---|---|
| **PV-Anlage** | 15.8 kWp, Süd, 35° Neigung | Forecast.Solar API |
| **Batterie** | 13.8 kWh (Fronius-verwaltet) | Fronius API (P_Akku, SOC) |
| **Smartfox Pro Energiemanager** | 192.168.188.45 | `/all` HTTP-Endpoint (Daten nicht mehr genutzt); regelt Batterie, Warmwasser, Auto selbst |
| **Fronius Wechselrichter** | 192.168.188.64 | `/solar_api/v1/GetPowerFlowRealtimeData.fcgi` |
| **Tuya Thermostate** | 12 × TGP508 (MAC 3C:0B:59), **per LAN (Kabel) angebunden, nicht WLAN** | Tuya Cloud (Cloud-Modus) ODER Port 6668 (Lokal-Modus) |
| **Standort** | 47.24983°N, 12.25415°E (Österreich), Europe/Vienna | — |

### Wer steuert was (Grundsatz, Uli 01.11.2026)

**Unser System steuert ausschließlich über die Thermostate.** An Smartfox und Fronius wird nichts eingestellt –
keine Regeln, die sich mit unserer Steuerung überkreuzen.

| Gerät | Rolle | von uns gesteuert? |
|---|---|---|
| **Smartfox Pro** (Energiemanager) | regelt Batterie und Verbraucher: PV-Überschuss lädt **zuerst die Batterie**, danach Warmwasser und Auto | nein |
| **Fronius** (Wechselrichter + Batterie) | liefert die Messwerte (PV, Verbrauch, Netz, Batterie, SOC) | nein |
| **TGP508-Thermostate** | Heizung je Raum | **ja** – einziger Steuerweg |

**Batterie-Verhalten (Recherche Smartfox-/Fronius-Doku, 01.11.2026):** Der Smartfox regelt die Batterie auf
„0 W Netzbezug“ (Smartfox-Batteriemodell „Fronius Control“: Zielwert 0 W, max. Entladeleistung, Mindest-SOC)
bzw. der Fronius selbst bei Batteriemodell „Fronius“. In beiden Fällen gilt: **Reicht die PV nicht, deckt die
Batterie jeden Verbrauch im Haus – tags wie nachts – bis zum Mindest-Ladestand (bei uns ~4–5 %).** Erst darunter
kommt Netzstrom. Belegt am 31.10.2026: 15–17 Uhr Entladung mit 3,4–5,6 kW für die Heizung, Batterie 85 → 5 %.

Folge: „Sonne zuerst in die Batterie“ lässt sich **nur über die Heizlast** erreichen, also über unsere
Thermostat-Sollwerte. Das macht die Regel **Ladestand-Grenze** in `pv-automation` (Tagesmodus `battery_gate`,
in der App „Batterie-Schutz“; Wert `heating_min_battery_soc`, 75 %). Sie ist **nicht** der Batterieschutz des
Wechselrichters (Mindest-SOC), den wir weder steuern noch ändern. **Seit 02.11.2026 gilt sie nur an Sonnentagen**
(Überschuss nach Batterieladung reicht für den Eco-Bedarf); an Tagen ohne genug PV und abends ist Eco das Ziel aus
Batterie/Netz (fester Tarif, Grundlast ≈ 0). Konzept `doc/KONZEPT-RAUMMODELL-2026-11-02.md`.

**Thermostat-Inventar:** 11 statische IPs (192.168.188.42, .43, .61–.69, .79). 10 Local Keys verfügbar.

---

## 2. Datenpipeline & Polling

```
Fronius (Smartfox liefert keine Daten mehr)
    ↓ (Polling alle 300 s, seit Sept. 2026)
Local Collector (Node.js, im LAN)
    ↓ (HTTP zu Supabase)
energy_readings (5-Min-Granularität)
    ↓
Frontend (15–60 s Polling, KEIN Realtime)
```

**Wichtige Regeln:**
- **Polling-Intervall:** Collector 300 s, `pv-automation` per pg_cron alle 5 Min + Anstoß durch den Thermostat-Dienst nach jedem Sync (kein Supabase-Realtime — verursachte PGRST002-Fehler)
- **Lokaler Collector** ist erforderlich (CORS verhindert direktes Browser-Polling von LAN-Geräten)
- **Zwei separate Prozesse:** Fronius-Collector (Daten) und Tuya-Local-Service (Thermostat-Steuerung) sind strikt getrennt
- **Vorzeichen (Fronius, verifiziert):** `power_io` positiv = Netzbezug, negativ = Einspeisung; `battery_power` positiv = Entladen, negativ = Laden (pv-automation dreht intern auf positiv = Laden). Die frühere „Smartfox-Inversion“ gilt nicht mehr.
- `power_smartfox` und `relay_status`: Altspalten aus der Zeit, als der Smartfox Daten lieferte – werden nicht mehr gefüllt.

**Aufbewahrung (`cleanup_old_data` täglich):**
- Rohdaten `energy_readings`: 7 Tage
- Stundenaggregate `hourly_aggregates`: 90 Tage
- Tagesmuster `daily_patterns`: unbegrenzt
- `thermostat_commands` >1 Tag: gelöscht
- `api_errors` resolved: gelöscht

---

## 3. Datenbank-Schema (Kernkonzepte)

**Quelle der Wahrheit für Heiz-Status:** `room_heating_logs` (NICHT `rooms.is_heating` — letzteres kann veralten). Seit 26.10.2026 schreibt der Trigger `trg_log_room_heating_transition` jeden Wechsel von `rooms.is_heating` als `heating_start`/`heating_stop` (lokal und Cloud).
- `event_type`: `heating_start`, `heating_stop`, `pv_activate`, `pv_deactivate`, `manual_set`
- Aktive Räume = `heating_start` ohne nachfolgendes `heating_stop`

**Räume (`rooms`):** Priorität 1–12 strikt (jede Zahl genau einmal). Felder: `automation_enabled` (**Hauptschalter**: nur Räume mit `true` werden von pv-automation überhaupt geladen und gesteuert – aus = keine Befehle, auch kein Nacht-/Frostschutz), `night_temp`, **`wait_min_temp`** („Untergrenze“, Mindesttemperatur ohne PV-Überschuss, seit 27.10.2026; leer = Eco − 1,5 °C), `eco_temp`, `comfort_temp`, `manual_override_until`, `tuya_device_id`, `local_key`. `pv_auto_enabled` wird von pv-automation **nicht ausgewertet** (Befund 27.10.2026).

**Heating Settings (Auszug, Werte Stand 27.10.2026):**
- `night_start_time`, `night_end_time` (Code-Standard 22:00–08:00; eingestellt 22:00–08:00, am 01.07.2026 über die App gesetzt). `night_end_time` = Tagesstart / Morgenbewertung
- `night_heating_mode`: `frost_only` (5°C) | `maintain` (Nachtwert halten, eingestellt seit 03.11.2026; seit 06.11.2026 unter der Leistungsgrenze)
- `heating_min_battery_soc` (Code-Standard 80 %, eingestellt 75 %) + `heating_soc_gate_mode` (`strict`): Batterie-Gate, einziger wirksamer SOC-Schwellwert für die Heizung
- `max_grid_heating_power_w` (4000 W seit 04.11.2026): **Max. Heizleistung ohne PV** – Summe der Räume, die ohne Budget gleichzeitig heizen dürfen. Gilt seit 06.11.2026 **immer**: tagsüber (Wartetag / ohne PV) **und nachts**, auch für Räume unter der Untergrenze; ein Raum, der allein größer ist, heizt nur allein (`doc/FIX-HEIZLEISTUNG-2026-11-06.md`). Im Batterie-Schutz gilt `battery_gate_max_power_w`
- `cap_wait_boost_min` (60 min, seit 06.11.2026): wer so lange auf freie Leistung wartet, kommt zuerst dran (Zustand `system_settings.cap_wait_state`)
- `battery_gate_floor_delta` (0 °C seit 02.11.2026, vorher 1,0), `battery_gate_max_power_w` (1000 W): Notfall-Heizen im Batterie-Schutz (seit 01.11.2026)
- `battery_night_reserve_pct` (10 %): Reserve des Batterie-Vorschlags über dem gemessenen Nachtbedarf (seit 01.11.2026)
- `presence_control_enabled` (true), `presence_lead_hours` (6 h): **Anwesenheit** (seit 28.10.2026, umgedreht 01.11.2026) – Grundzustand anwesend; Kalender `presence_periods` = Zeiträume, in denen das Haus **leer** ist; Vorlauf vor dem Ende (Rückkehr). Aus = immer anwesend
- `target_battery_soc`, `min_battery_soc`: **deprecated** (DB-Reste ohne Logik, siehe `memory/soc-thresholds-consolidated.md`)
- `battery_reserve_for_night_soc` (60%): nur noch für Batterie-Puffer und Mikro-Budget-Untergrenze. Wird vom KI-Batterie-Vorschlag **nicht** geändert (seit 28.10.2026; vorher beim Übernehmen mit überschrieben)
- `battery_buffer_enabled`, `battery_buffer_bonus_w` (500W)
- `tolerant_deactivation_enabled` (true)
- `micro_budget_enabled`, `micro_budget_min_battery_soc` (80%), `micro_heat_duration_min` (5)
- `pv_surplus_threshold_on/off` (500W / 200W)
- `min_room_pause_minutes` (15), `room_rotation_minutes` (30)
- `power_budget_tolerance_w` (200), `max_grid_heating_power_w` (2000)

**Battery Daily Tracking (`battery_daily_tracking`, unique pro Datum):**
- `soc_at_heating_start` (~09:00), `soc_at_heating_end` (17–19 Uhr), `soc_at_morning`
- `min_soc_during_night`, `night_consumption_kwh`, `heating_battery_used_kwh`

---

## 4a. Heizplaner (Schattenbetrieb, seit 06.11.2026)

Rechnender Planer statt fester Regeln, Konzept `doc/KONZEPT-PLANER-2026-11-06.md`. Edge Function `heizplaner`: alle 15 min (über `analysis-scheduler`) ein 24-h-Plan je Raum und halbe Stunde, der Netzstrom + Komfortabweichung minimiert (gelerntes Raummodell `heizmodell`, gelernte PV-Vorhersage `system_settings.planer_pv_modell` mit Nachführung, Batterie, Leistungsgrenze). Täglich 03:00: Raummodell je Raum lernen, PV lernen, Vortag gegenrechnen (`heizplan_vergleich`). **Steuert noch nicht** (`heating_settings.planer_modus = schatten`); Anzeige KI › Planer. Gewichte: `planer_gewicht_ziel` (0,6 kWh je °C·h unter Ziel), `planer_gewicht_unter` (2), `planer_sicherheit_abstand` (1,5 °C). SQL 25.

## 4. PV-Automation: 4-Stufen-Logik

`pv-automation` läuft alle 5 Minuten (pg_cron `pv-automation-check`) und zusätzlich nach jedem Sync des Thermostat-Dienstes. Kumulatives Budget — keine Momentaufnahme.

> **Grundkonzept (verbindlich):** `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md` – Batterie gehört der Nacht, Eco ist Tagesstandard, ist Überschuss absehbar wird gewartet, Überschuss wird nach Priorität verteilt (erst Eco, dann Komfort).

### Stufe 1: Sicherheits-Gates (sequentiell, jeder kann blockieren)
1. **Übertemperatur:** `currentRoomTemp >= target + 0.4` bei `is_heating` → Stop auf Eco
2. **Manual Override:** `manual_override_until > now()` → unbedingt respektieren
3. **Hard PV Gate:** `pv_power < 300W` UND `forecast_kwh < 8` → kein PV-Heizen (fest im Code)
4. **Batterie-Schutz (Ladestand-Grenze):** SOC < `heating_min_battery_soc` **und Sonnentag** (seit 02.11.2026; Tagesart = (Rest-PV − Grundlast − Batterie bis voll) / Eco-Bedarf ≥ Schwelle) – auch wenn die Batterie lädt (seit 01.11.2026). strict: Eco-Budget nur aus echter Einspeisung (≥ `pv_surplus_threshold_on`), Komfort 0; aktive Stopps auf **Untergrenze − `battery_gate_floor_delta`**; Notfall-Heizen darunter bis `battery_gate_max_power_w` (Konzept Tagesablauf §3.4)
5. **Quota Exhausted** (nur Cloud-Modus): keine Schreib-Operationen

### Stufe 2: Phase 1 — Eco für Räume unter Eco, nach Priorität
- Sortiert nach Priorität (1 → 12)
- Nur Räume mit `current_temp < eco_temp − 0.3` (seit 27.10.2026; vorher auch „Sollwert ≤ Nacht“)
- Pro Raum: `usedBudget + heatingPower <= availableBudget` → aktivieren mit `eco_temp`, Kennzeichen `budgeted`
- Wenn überschritten: prüfe **Tolerante Deaktivierung** (siehe §8) für bereits heizende Räume

### Stufe 3: Phase 2 — Komfort-Upgrades
- Nur wenn Phase 1 vollständig
- Strikt: `comfortBudget = gridExport` (kein Batterie-Bonus, kein Trend-Bonus)
- Ohne zusätzliches Komfort-Budget dürfen nur Räume upgraden, die in Phase 1 echtes Eco-Budget hatten (seit 27.10.2026)

### Stufe 3b: Tagesmodus für Räume ohne Budget (seit 27.10.2026)
Räume, die in Phase 1/2 **kein** Budget bekommen haben (Budget-Stopp, Rotation, warm, Phase 2 wartet), fallen nicht mehr pauschal auf Eco zurück. Ihr Ziel kommt aus dem Tagesmodus:

| Modus | Bedingung | Ziel |
|---|---|---|
| `battery_gate` | Batterie-Schutz aktiv (strict, nur Sonnentag) | „Untergrenze − Abstand“ (seit 02.11.2026 Abstand 0); Notfall darunter bis `battery_gate_max_power_w` (1000 W) |
| `wait` (Sonnentag) | (PV-Rest − Grundlast − Batterie bis voll) / Eco-Bedarf ≥ Schwelle (1,0 ± KI, Grenzen 0,5–1,5) | „Untergrenze“ |
| `wait` (abwesend) | laufender Eintrag in `presence_periods` (Abwesenheit, ohne Vorlauf vor Rückkehr), seit 01.11.2026 – auch nach Sonnenuntergang | „Untergrenze“; PV-Überschuss trotzdem Eco → Komfort |
| `grid` (schlechter Tag) | sonst, und immer nach Sonnenuntergang – **auch bei Batterie unter der Grenze** (seit 02.11.2026) | Eco nach Priorität aus Batterie/Netz, Summe der Raumleistungen ≤ `max_grid_heating_power_w` |

**Raummodell / Vorausschau (seit 02.11.2026):** Je Raum gelernte Auskühlrate k (Tabelle `raum_abkuehlung`, View `raum_modell`, SQL 18) und Außentemperatur-Prognose der Nacht → „abends nötig“ für Eco am Morgen. Bei gleicher Priorität bekommt der Raum mit dem größten Nachtbedarf die PV zuerst. Protokoll in `system_settings.raum_vorausschau`, Anzeige Protokoll › Raummodell. Konzept `doc/KONZEPT-RAUMMODELL-2026-11-02.md`.

- In jedem Modus werden Räume **unter** „Untergrenze“ zuerst bis „Untergrenze“ geheizt – seit 06.11.2026 wieder **unter der Grenze** (Uli: „Grenze gilt immer“; 05.11. hatte das Wohnzimmer mit 5,5 kW die Grenze 4000 W gesprengt). Reihenfolge: Wartezeit-Vorrang (`cap_wait_boost_min`), dann Priorität. Ist noch nichts belegt, darf ein Raum über der Grenze allein heizen – nur bis Untergrenze. Wer nicht passt, wartet mit „Ist − 0,5 °C“. Räume im Nachlauf (heizen über dem Ziel) zählen mit. Funktion `allocateUnderCap`, `doc/FIX-HEIZLEISTUNG-2026-11-06.md`.
- KI-Schwelle aus `best_match_today` × `pattern_recall_strength` (siehe §12).
- Funktion `allocateDayTargets`, Protokoll je Lauf in `system_settings.heating_day_mode`, Anzeige in der Übersicht.
- Tagesmodus-Ziele erzeugen keine `solar_limit_start/stop`-Einträge und setzen `pv_auto_active = false`.

### Stufe 4: Physische Soll-Korrektur
- Der lokale Dienst schreibt den tatsächlichen Thermostat-Sollwert in `rooms.target_temp`
- Weicht er vom gewünschten Ziel ab, sendet pv-automation beim nächsten Lauf neu (`tempAlreadyCorrect`)

### Anwesenheit (seit 28.10.2026)
Konzept: `doc/KONZEPT-ANWESENHEIT-2026-10-28.md`. Seit 01.11.2026 (§9) gilt: **Grundzustand anwesend**. `getPresence()` liest `presence_periods` (Einträge = Abwesenheiten): Eintrag läuft und endet nicht innerhalb von `presence_lead_hours` → **abwesend**, sonst anwesend. Abwesend heißt: Tagesmodus `wait` (Batterie-Gate hat Vorrang). PV-Überschuss heizt wie anwesend – Phase 1 Eco, Phase 2 Komfort (seit 30.10.2026 kein Eco-Deckel mehr). Nacht unverändert. Fail-safe: Kalender nicht lesbar oder Steuerung aus → anwesend. Protokoll: `heating_day_mode.away`, `presence_reason`, `presence_next_start`.

**Reihenfolge zwingend:** 1 → 2 → 3 → 3b → 4.

## 5. Eco- vs. Komfort-Budget

### Eco-Budget (`availableBudget`) — flexibel
```
availableBudget = gridExport
                + currentlyHeatingPower      // bereits heizende Räume zurückrechnen
                + dynamicTolerance           // power_budget_tolerance_w
                ± batterieKorrektur          // siehe unten
                + prognoseBonus              // 0 / 400 / 800 / 1500W (gestuft)
                + batteriePuffer             // 0–500W (siehe §6)
                + pvTrendBonus               // +300W bei Trend > +500W
```

**Batterie-Korrektur:**
- Bei Entladung (`battery_power < 0`): availableBudget reduzieren
- Bei SOC < 80%: Ladereserve abziehen

**Prognose-Bonus** (nur Eco, nur tagsüber ≥9 Uhr):
| Bedingung | Bonus |
|---|---|
| PV-Rest ≥ 3× Eco-Bedarf UND SOC ≥ 50% | +1500W |
| PV-Rest ≥ 2× Eco-Bedarf UND SOC ≥ 60% | +800W |
| PV-Rest ≥ 1.5× Eco-Bedarf UND SOC ≥ 70% | +400W |

### Komfort-Budget (`comfortBudget`) — strikt
```
comfortBudget = gridExport     // NUR echter Export, keine Boni
```
Niemals Batterie, Prognose, Trend oder Reserve einbeziehen. Komfort-Heizen darf nie Netzbezug verursachen.

---

## 6. Batterie-Reserve & Puffer

**Ziel:** Batterie als Reserve für Abend-/Nachtverbrauch schützen — nicht für Heizung leerziehen.

### Reserve (`battery_reserve_for_night_soc`, default 60%)
- Schutz-Untergrenze für Abendnutzung
- Mikro-Budget Untergrenze wird dynamisch erhöht: `microMinSoc = max(micro_budget_min_battery_soc, reserve + 20)`

### Batterie-Puffer (gestuft, nur wenn `battery_buffer_enabled`)
`socAboveReserve = batterySoc - battery_reserve_for_night_soc`

| Δ ≥ | Anteil von `battery_buffer_bonus_w` |
|---|---|
| 35 | 100% |
| 25 | 60% |
| > 20 | 30% |

**Doppel-Gate für Puffer-Aktivierung:**
- `remainingPvForHeatingWh ≥ totalEcoEnergyNeededWh`
- `pvTrend ≥ -300W`

### PV-Trend (5-Min-Vergleich, automatisch)
- Trend > +500W → Bonus +300W zum Eco-Budget
- Trend < -200W → blockiert Tolerante Deaktivierung
- Trend < -300W → blockiert Batterie-Puffer

### Validierung (`validate-battery-reserve`, täglich 09:05)
Schreibt nach `system_settings.battery_reserve_validation`:
- `ok` (Reserve gehalten)
- `increase_reserve_to_X` (knapp verfehlt)
- `decrease_reserve_to_X` (zu konservativ — Reserve am Morgen weit überschritten)

---

## 7. Mikro-Budget & Soft-Rotation

**Trigger:** `0 < availableBudget < minRoomPower` UND `batterySoc >= microMinSoc`

**Auswahl:** 1 Raum nach Score = `Priorität × 100 + Defizit × 10 + PauseMinuten`

**Aktivierung:** `target_temp = eco_temp` + `system_settings.last_micro_rotation_at = {ts, room_id, ended:false}`

**Soft-Beendigung:** Nach `micro_heat_duration_min` (5) aktiv beenden:
- `target_temp = wait_min_temp` („Untergrenze“, seit 27.10.2026; vorher night_temp)
- Status: `ended:true`, `ended_at: now()`

**Cooldown** (`room_rotation_minutes`, 30): zählt ab `ended_at`, nicht ab Aktivierung. Kein neuer Mikro-Raum solange `ended === false`.

**Manual Override** blockiert sowohl Aktivierung als auch Soft-Beendigung.

---

## 8. Tolerante Deaktivierung

**Greift NUR in Phase-1-Eco-Loop, NUR für bereits heizende Räume bei kurzem Budget-Einbruch.**

```ts
const overshoot = (usedBudget + rp.heatingPower) - availableBudget;
const tolerate =
     tolerant_deactivation_enabled
  && rp.isCurrentlyHeating          // nicht für Neuaktivierungen
  && pvSufficientForEco             // Tagesprognose reicht
  && pvTrend >= -200                // PV nicht im Einbruch
  && overshoot <= max(300, heatingPower * 0.4);  // Stacking-Schutz
```

**Verhalten:**
- Bei Wolke (kurzer PV-Dip): Raum heizt durch → keine Tuya-Calls
- Bei Sonnenuntergang (Trend < -200W): harter Cutoff wie ohne Toleranz
- Selbstbegrenzend: max ~3 Räume × 300W = 900W über Budget

**Quota-Ersparnis:** Pro toleriertem Raum 2 Tuya-Calls eingespart (Deaktivierung + spätere Reaktivierung).

**Logging:** `[TOLERANT-DEACTIVATION]` pro Raum, `[TUYA-QUOTA-RUN]` Run-Counter.

---

## 9. Nacht- vs. Tagbetrieb

**Nachtfenster:** `night_start_time` → `night_end_time` (Europe/Vienna), eingestellt 22:00–08:00. Keine festen Uhrzeiten im Code mehr außer Rückfallwerten (22:00 / 08:00). Zeitzone geprüft 27.10.2026: Befehle kommen exakt zu `night_end_time` Wiener Zeit, auch über die Zeitumstellung.

### Nacht
- `frost_only` (eingestellt): einmaliger Befehl je Nacht, alle Räume auf 5 °C (fest im Code), danach Ruhe (Gate `night_frost_last_pushed`)
- `maintain` (eingestellt seit 03.11.2026): Ziel je Raum max(Nachtwert, Untergrenze). Seit 06.11.2026 **bei jedem Lauf** neu verteilt unter `max_grid_heating_power_w` (wie tagsüber, `allocateUnderCap`), kein Quiet Mode mehr – vorher setzte ein einmaliger Push alle Räume gleichzeitig hoch (03./04.11.: 7–11 kW die ganze Nacht). Manuell übersteuerte Räume zählen mit, Räume mit Automatik aus bleiben unberührt. Begründung je Raum in `system_settings.heating_night_mode`.

### Tag (ab `night_end_time`)
Morgenbewertung bei jedem Lauf neu: Tagesmodus `battery_gate` / `wait` / `grid` (§4 Stufe 3b). Räume mit Budget heizen nach Phase 1/2, Räume ohne Budget bekommen das Tagesmodus-Ziel. Die Prognose-Boni dürfen schon `floor_heating_response_hours` (eingestellt 2 h, Untergrenze 06:00) vor dem Tagesstart greifen.

### Suppression
- ML-Empfehlungen (`analyze-patterns`) sind im Nachtfenster komplett unterdrückt

### Hysterese (Anti-Flapping)
- Thermostat-intern; pv-automation stoppt hart bei `currentTemp >= target + 0.4 °C` (Übertemperatur) und plant mit 0,3 °C Abstand zu Eco/Komfort

### Thermostat-Modus (wichtig)
Seit Dienst v1.3 (24.10.2026) schaltet jeder Sollwert das TGP508 auf **„home“** (manuell). Vorher blieben die Thermostate auf **„auto“** (eigenes Wochenprogramm) und überschrieben die Sollwerte von pv-automation – die Steuerlogik hat bis 23.10.2026 praktisch nie gewirkt. Analyse: `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md` §5.1.

### Regelpunkt der Thermostate (Befund 01.11.2026)
Gemessen über 3 Tage (Schaltpunkte je Raum): Die TGP508 schalten nicht um den Sollwert, sondern um **Soll +0,6 bis +1,0 °C** (Wohnzimmer 40 Zyklen: ein +0,65, aus +0,69 °C); die eigentliche Schaltdifferenz ist klein (0,2–0,4 °C). Verdacht: DP 19 = −10 (Temperatur-Korrektur −1,0 °C) wirkt auf die Regelung, nicht auf die gemeldete Temperatur. Test mit DP 19 = 0 am Büro über den Tab Protokoll (`doc/PROTOKOLL-MODUL-2026-11-01.md`). Alle Datenpunkte je Gerät: Tabelle `thermostat_state`.

### Protokoll (seit 01.11.2026)
Tab **Protokoll** und Tabelle `protokoll_events` (Trigger, SQL 11): jede Sollwert-Änderung mit Begründung (`thermostat_commands.reason`), heizt an/aus, Tagesmodus, Einstellungen alt → neu, Abwesenheit, Thermostat-Auffälligkeiten, Fehler. Details: `doc/PROTOKOLL-MODUL-2026-11-01.md`.

## 10. Tuya-Steuerung & Quota-Schutz

**Quota-Limit:** 30 Calls/Tag (Minimal-Subscription).

### Dual-Modus (manuell umschaltbar via `useControlMode`)
| Modus | Befehlsweg | Vorteile |
|---|---|---|
| **Cloud** | Edge Function `tuya-control` → Tuya IoT Cloud API | Standortunabhängig |
| **Local** | DB-Tabelle `thermostat_commands` → Local Service (Port 6668) | Keine Quota |

**Kein automatischer Failover** — User muss bewusst umschalten.

### Quota-Schutzmechanismen (alle aktiv)
1. **`tempAlreadyCorrect`-Gate:** Bei korrekter Soll-Temp → kein Call
2. **Cooldown-Gate:** `min_room_pause_minutes` (15)
3. **120-Min Cloud-Sync:** Begrenzt redundante Sync-Calls
4. **Quota-Check:** Bei Erschöpfung → alle Schreib-Ops blockiert
5. **Tolerante Deaktivierung:** Spart Cycling-Calls bei wechselhaftem Wetter

### TGP508 DPS-Mapping
- Cloud: `mode`, `temp_set`, `temp_current`, `switch`, `work_state`
- Lokal (verifiziert 24.10.2026, Dienst v1.3): DP 1 Ein/Aus · DP 2 Soll ×10 · DP 3 Ist ×10 · DP 4 Modus `auto`/`home` · DP 5 heizt `"1"`/`"0"`
- **Alle Datenpunkte des TGP508** (BEOK-Datenmodell, Recherche 01.11.2026) – vollständige Tabelle in `doc/THERMOSTAT-DATENPUNKTE.md`:

  | DP | Bedeutung | Stand 01.11.2026 |
  |---|---|---|
  | 1 | Ein/Aus | true |
  | 2 / 3 | Soll / Ist, ×0,1 °C | – |
  | 4 | Modus `home` (manuell) / `auto` (Wochenprogramm) / `temporary` | home |
  | 5 | heizt `"1"`/`"0"` | – |
  | 9 | Kindersicherung | false |
  | 11 | Fehler (E01 = Fühler) | 0 |
  | 15 | höchster Sollwert, °C | 60 |
  | **19** | **Temperatur-Korrektur, ×0,1 °C (−99…99)** | **−10 = −1,0 °C** |
  | **101** | **Einschalt-Differenz, ×0,1 °C (5…100, Schritt 5)** | **10 = 1,0 °C** |
  | 102 | Grenztemperatur Fühler, °C | 60 |
  | 103 | Frostschutz des Geräts | gemischt |
  | 104 | Werkseinstellung | false |
  | 105 | Nachtprogramm (Zeiten, Rohdaten) | – |
  | 106 / 107 | unklar (Hintergrundlicht? / Fenster?) | "3" / "1" |
  | 108 | Ausgang umkehren | false |
  | 109 | Tastenton | true |
  | 110 | Fühlerwahl ("1" = Raumfühler im Gerät) | "1" |
  | **111** | **Nachtmodus des Geräts** (eigenes Programm mit falscher Uhr) | an bei 6 Räumen – soll aus sein |

  Ändern über Tab Protokoll › Thermostate (freigegeben: 19, 101, 103, 111).

### Lokaler Thermostat-Dienst (v1.4, Stand 01.11.2026)
Läuft auf dem Österreich-PC als NSSM-Dienst **SmartfoxTuya** im Ordner `C:\Users\ulibe\tuya-thermostat`
(`index.js` = Collector v3.1, `tuya-thermostat.js` = Treiber v1.4, `config.json` mit Geräten und Local Keys –
**nicht** im Repo). Quelle im Repo: `local-collector/collector-node/`. Eingespielt wird per Kopieren +
`nssm restart SmartfoxTuya`.
1. **Frische Verbindung je Aufruf** (`createDevice` → find → connect → get/set → disconnect), Timeout 10 s, `issueRefreshOnConnect: true`.
2. **Protokoll-Version:** `protocol_version` je Gerät in `config.json`, Standard 3.5; scheitert 3.5, einmal 3.3 versuchen; danach 2 Wiederholungen mit Wartezeit (2 s, 4 s).
3. **DPS-Mapping:** siehe oben. Das frühere Mapping `MODE='1'`, `HEATING='4'` war falsch.
4. **setTemperature atomar:** Modus `home` + Soll in einem Befehl. pv-automation schickt deshalb seit 27.10.2026 kein separates `set_mode` mehr.
5. **TCP-Preflight** (`tcpProbe`, Port 6668, <1 s) vor jedem Sync – unerreichbare Geräte sofort als `device_offline`, erreichbare in Gruppen zu 3.
6. **Seit v1.4:** alle Datenpunkte nach jedem Auslesen per RPC `thermostat_state_upsert` in die Datenbank; Befehle `read_now` und `set_dp` (nur DP 19, 101, 103, 111) – siehe `doc/PROTOKOLL-MODUL-2026-11-01.md`.
7. Der frühere eigenständige „Dienst v2.0“ (`tuya-thermostat-v2/`, `.env`) und die Variante mit Befehls-Warteschlange und dauerhaften Verbindungen („Hybrid v4“) sind **nicht** im Einsatz.

> **Wichtig:** Bleibt ein Gerät trotz Versions-Sweep im Timeout, ist der `local_key` veraltet (Gerät in Tuya/Smart-Life-App neu gekoppelt → Key rotiert). Key neu holen (API Explorer/TinyTuya) und in `config.json` eintragen.


### Push-All Funktion
„Alle Sollwerte erneut senden“ (Einstellungen › Betrieb, mit Rückfrage) — überschreibt physische
Werte mit DB-Targets. Lokal: je Raum ein `set_temp` in `thermostat_commands`; Cloud:
`tuya-control/push-all-temps` (Kontingent-Gate). Setzt im Lokal-Modus **kein**
`last_thermostat_sync` (das schreibt nur der Dienst nach echter Lesung, Fix 26.10.2026).

### Bedienung im Frontend (Stand 26.10.2026)
| Aufgabe | Ort | Lokal | Cloud |
|---|---|---|---|
| Ansehen + kurz übersteuern (1–24 h) | Übersicht | `thermostat_commands` | `tuya-control/set-temp` |
| Grundwerte, PV-Automatik, **Automatik je Raum** | Einstellungen › Räume | – | – |
| Alle Sollwerte erneut senden | Einstellungen › Betrieb | `thermostat_commands` | `push-all-temps` |
| Werte aus der Cloud lesen (nur Cloud sichtbar) | Einstellungen › Betrieb | – | `sync-all?force=1` |
| Modus, Verbindungstest, Region, Abo | Einstellungen › Betrieb / Tuya Cloud | – | `/test`, `/set-region` |
| Fehlerbanner „Erneut versuchen“ | Heizung & KI | pv-automation + DB | + `sync-all` |

Die frühere Karte „Thermostat-Steuerung“ (Tab Heizung & KI) ist entfallen. Details:
`doc/THERMOSTAT-STEUERUNG-AUFGELOEST-2026-10-26.md`.

### API-Error-Logging
- `api_errors`-Tabelle (mit `device_id`, `error_code`, `retry_count`, `is_acknowledged`)
- Banner exklusiv im Heating-Dashboard (`ApiErrorBanner`)
- 3-Strike-Retry, dann Eskalation

### Subscription-Monitoring
Settings zeigt Tuya Cloud Develop Base Resource Ablaufdatum.

---

## 11. Sicherheits-Gates & Ghost-Heating-Prevention

**Ghost Heating** = Hardware heizt obwohl DB sagt "Aus". Drei Mechanismen:

1. **Stufe 4 Tagesziel-Korrektur:** Vergleicht DB- mit physischem Wert, korrigiert Abweichungen
2. **Hysterese-Stop:** `temp >= target + 0.3°C` → garantiert Ausschalten
3. **Sicherheits-Gates** (Übertemp, Solar-Limit, Manual Override) prüfen unabhängig vom Budget

**Aktive-Heizung-Quelle:** Dashboard zeigt aktive Heizungen aus `room_heating_logs` (echte Events), nicht aus `rooms.is_heating` (kann lügen).

---

## 12. Machine Learning & AI

> **Lernschleife (seit 01.11.2026, verbindlich):** `doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md`. Gelernt wird nur aus Daten ab
> `system_settings.learning_data_since` (26.10.2026); jeder Tag bekommt eine Note nach Ulis Zielen (`tages_bewertung`:
> Nacht · Sonne · Komfort · Netz); Vorschläge kommen aus den bestbewerteten ähnlichen Tagen und werden von Uli übernommen.
> Die Grundregeln (Batterie gehört der Nacht, Sonne zuerst in die Batterie, Untergrenze) hebt die KI nie auf.
> **Altdaten:** Heizungsbezogene Daten vor dem 26.10.2026 beschrieben das Wochenprogramm der Thermostate und wurden am
> 01.11.2026 gelöscht bzw. geleert (SQL `15_altdaten_loeschen.sql`); berechnete Raumleistungen werden aus sauberen
> Heizzyklen neu berechnet, bis dahin gilt `heating_power_w`.

**AI-Provider:** **Direkte Google Gemini API** (`gemini-2.5-flash`). Keine Lovable AI Gateway. Secret: `GOOGLE_AI_API_KEY`.

### Komponenten
- **`analyze-patterns`** — generiert Empfehlungen, im Nachtfenster suppressed
- **`ml-feature-extraction`** (täglich) — rekonstruiert Heizzyklen aus `room_heating_logs`, schreibt `room_ml_features`
- **`evaluate-decision`** — bewertet vergangene Entscheidungen (Reward-Funktion)
- **`update-learned-policies`** (täglich 19:30 UTC) — aggregiert zu `learned_policies`, seit 01.11.2026 nur aus Ereignissen ab `learning_data_since`
- **`generate-settings-suggestions`** — KI-Vorschläge für Heating-Settings (whitelisted)

### Reward-Funktion
- Action-Bonus für korrekte Entscheidungen
- 10% Penalty pro Wh Netzbezug
- Korrigiert Negativ-Bias gegen "Ausschalten"

### Mustergedächtnis im Tagesmodus (seit 27.10.2026)
`best_match_today` (ähnlichster vergangener Tag) verschiebt die Schwelle zwischen Wartetag und „ohne PV“: PV-Heizdeckung des ähnlichen Tages ≥ 60 % → Schwelle sinkt (eher warten), < 30 % → steigt. Stärke = `pattern_recall_strength`/100 × 0,3 × Qualität (exact 1,0 / partial 0,6), max. ±0,3. Achtung: Tage vor dem 24.10.2026 zeigen das Verhalten der Thermostat-Wochenprogramme, Heizzyklen werden erst seit 26.10.2026 erfasst.

### Batterie-Vorschlag (seit 01.11.2026)
`ai-parameter-advisor` /suggest-battery-soc (21:00): Mindest-Ladestand = gemessener Nachtbedarf (`nacht_protokoll`) + Abend/Morgen ohne PV (Stundenprognose × Grundlast) + `battery_night_reserve_pct`. Mustergedächtnis (`daily_pattern_scores`, Prognose ±30 %) korrigiert die PV-Prognose und rechnet aus, was nach dem Laden für die Heizung frei bleibt (Räume nach Priorität). Alte Regel „Prognose < 10 kWh → Grenze hoch“ entfernt. Nur Vorschlag, Übernehmen im Tab KI. Konzept Tagesablauf §10.

### KI › Zu entscheiden (seit 04.11.2026)
Alle Vorschläge an einem Platz, in einfachen Worten (Konzept KI-Vorschläge §9). **`ki-tagesanalyse`** (täglich 10:00 über `analysis-scheduler`, nach der Tagesnote 09:55) schreibt `ki_tagespaket` (Rückblick auf gestern) und `ki_vorschlaege`: drei feste Regeln über 7 Tage (Untergrenze je Raum, Heizleistung ohne Sonne, Estrich laden bis je Raum), nur Whitelist-Werte (SQL 20), nur bei ≥ 3 passenden Tagen, höchstens 3 am Tag; 3 Tage nach jeder Genehmigung Wirkungsbericht über die Tagesnote, bei Verschlechterung Rücknahme-Frage. Tageswerte je Raum aus `ki_raum_tag(p_tag)`. Die Batterie-Empfehlung erscheint im selben Format; geschrieben wird sie weiterhin nur über `battery-soc-decision` (jetzt auch mit eigenem Wert). Seit 06.11.2026 schlägt auch die Leistungsmessung (`measure-room-power`, 09:30) Raumleistungen vor (`heating_power_w`). Die stündlichen Gemini-Vorschläge (`ai-parameter-advisor-15min`) sind seit SQL 21 abgeschaltet. **Die KI ändert nichts selbst.**

### Architektur-Grenze
**AI empfiehlt Setpoints und verschiebt Schwellen — Kern-Budget-Logik (§4–8) ist die finale Filter.** AI kann Reward-Funktion nicht selbst korrigieren.

### Whitelist-Schutz
`generate-settings-suggestions` nutzt strikte Tool-Schemas mit Enums → verhindert Halluzinationen.

---

## 13. PV-Forecast & Wetter

### Forecast.Solar (`fetch-pv-forecast`, täglich 06:00)
```
https://api.forecast.solar/estimate/47.24983/12.25415/35/0/15.8
```
Speichert in `pv_forecasts`:
- `expected_kwh`, `hourly_watts` (jsonb), `sunrise`, `sunset`

**Sunrise/Sunset abgeleitet** aus erstem/letztem Watt-Wert >0.

**ISO-Timestamp Matching:** Bug behoben — Schlüssel werden präzise verglichen.

### Wetter (`fetch-weather`, Open-Meteo)
`weather_data`: Temperatur, Bewölkung, Strahlung (direkt + diffus), Wind, Niederschlag.

---

## 14. Edge Functions Übersicht

| Function | Zweck | Trigger | Auth |
|---|---|---|---|
| `pv-automation` | Heizungssteuerung 4-Stufen + Tagesmodus | pg_cron 5-Min + Anstoß durch Thermostat-Dienst | hybrid (anon/service_role JWT-decode) |
| `validate-battery-reserve` | Reserve-Tagesvalidierung | pg_cron 09:05 | service_role |
| `tuya-control` | Cloud API Wrapper | manuell + automation | hybrid |
| `fetch-pv-forecast` | Forecast.Solar | pg_cron 06:00 | service_role |
| `fetch-weather` | Open-Meteo | regelmäßig | service_role |
| `aggregate-energy-data` | Daten-Cleanup | pg_cron 03:00 UTC | service_role |
| `analyze-patterns` | ML-Empfehlungen | manuell + cron | hybrid |
| `apply-recommendations` | Policy → Thermostat | nach analyze-patterns | hybrid |
| `ml-feature-extraction` | Zyklus-Features | täglich | service_role |
| `evaluate-decision` | Reward-Berechnung | pro Decision | service_role |
| `update-learned-policies` | Policy-Aggregation (nur Daten ab `learning_data_since`) | pg_cron 19:30 UTC | service_role |
| `generate-settings-suggestions` | KI-Settings-Vorschläge | manuell | hybrid |
| `monitor-solar-heating` | Solar-Event-Erkennung | regelmäßig | service_role |
| `analyze-solar-gain` | Passiver Solargewinn | regelmäßig | service_role |
| `calculate-heating-power` | Power-Kalibrierung (alt, lief nie – kein Cron) | – | service_role |
| `heizplaner` | Planer (Schattenbetrieb): `planen` alle 15 min, `lernen` je Raum + `pv_lernen` + `vergleich` täglich 03:00 | `analysis-scheduler` | service_role |
| `measure-room-power` | Heizleistung je Raum messen (Regression Verbrauch ohne PV ~ „heizt“), Vorschläge in KI › Zu entscheiden | `analysis-scheduler` täglich 09:30 | service_role |

**Routing-Robustheit:** `/check` und Root-Pfad beide unterstützt.

---

## 15. Frontend-Architektur

**Stack:** React 18 + Vite 5 + Tailwind v3 + TypeScript + shadcn/ui.

### Seiten
- `Index.tsx` — 4 Tabs nach Zweck (seit 26.10.2026): **Übersicht** (`overview/HouseOverview`, jetzt), **Analyse** (`analysis/AnalysisTab`, Rückblick + Einstellungs-Vorschläge), **KI** (`ki/KiTab`, prüfen & entscheiden), **Einstellungen** (`energy/SettingsPanel`, inkl. Abschnitt KI und Heiz-Reihenfolge). Umzugsliste: `doc/NEUE-TAB-STRUKTUR-2026-10-26.md`
- `Auth.tsx` — Email/Passwort + Google OAuth
- `Install.tsx` — PWA-Installationsanleitung

### Wichtige Hooks
| Hook | Zweck |
|---|---|
| `useSmartfoxData` | Polling 30–60s `energy_readings` |
| `useHeatingSettings` | CRUD `heating_settings` |
| `useRooms` | CRUD Räume + PV-Auto-Toggle |
| `usePvForecast` | 7-Tage-Forecast |
| `useActiveHeatingRooms` | Aktive aus `room_heating_logs` |
| `useBatteryHistory` | Dynamic limits (heute 2k, Woche 5k, Monat 10k) |
| `useControlMode` | Cloud vs. Local Toggle |
| `useTuyaConnectionTest` | 3-Step Diagnostic |
| `usePushAllTemps` | Alle Sollwerte erneut senden (Lokal: Befehle, Cloud: push-all-temps) |
| `useTuyaControl` | `setTemperature` (Übersteuern, modusabhängig), `syncAllStatus({force, silent})` (Cloud-Lesung) |
| `useServiceWorkerUpdate` | Update-Banner alle 5 Min |
| `useDayAnalysis` | Wiener Kalendertag laden + `lib/dayAnalysis` (Energieflüsse, Heizung je Raum, Befunde) |
| `useKiPending` | Zähler offener KI-Entscheidungen (Tab-Badge, Hinweis in Übersicht) |

### UI-Standards
- **Default Light Theme** (#ffffff)
- **Mobile-First PWA**, Bottom-Tab-Bar
- **Kein `overflow-hidden` auf `<main>`** (Scroll-Bug-Prevention)
- **Heizung-Charts:** Stacked Bars sortiert nach Total
- **Status-Indikatoren:** Progressbalken (night→target = 0%–100%) + Waiting-Badges
- **Room-Manager-Dialog:** max-height 85vh
- **Energy-Breakdown:** Battery, Heating, Baseload getrennt
- **Active-Heating-Focus:** Live W/kW vor Historie

---

## 16. PWA & Service Worker

**Manifest:** `name=Heizung Venediger`, `short_name=Venediger`, `display=standalone`, `start_url=/`

**Workbox:**
- `skipWaiting: true`, `clientsClaim: true` (zwingend bei registerType autoUpdate – siehe Fix 23.10.2026)
- `runtimeCaching`: Supabase = NetworkFirst (5 Min, 50 Entries)

**Update-Strategie:**
- `useServiceWorkerUpdate`: prüft alle 5 Min + bei Focus
- Update-Banner oben (mobile: vor Bottom-Tabs)
- Offline-Fallback: `public/offline.html`

---

## 17. Sicherheit & RLS

**Modell:** Single-Household, alle authentifizierten User = volle Rechte.

```sql
CREATE POLICY "Authenticated users full access"
  ON public.<table> FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

### Anon-Policies (gezielt für Local Collector)
- `energy_readings`: INSERT
- `rooms`, `thermostat_commands`, `system_settings`, `data_retention_settings`: SELECT/UPDATE
- `api_errors`, `battery_daily_tracking`: INSERT/UPDATE/SELECT

### Spalten-Schutz
Trigger `protect_rooms_sensitive_columns`: anon kann NICHT `tuya_device_id` / `local_key` ändern.

### Auth
- Email/Passwort + Google OAuth
- Auto-Confirm Email-Signups: deaktiviert (sofern nicht explizit gewünscht)
- Roles in **separater Tabelle** `user_roles` (nie auf `profiles` oder `auth.users`)

---

## 18. Bekannte Limitierungen

| Bereich | Limit | Workaround |
|---|---|---|
| Tuya Cloud Quota | 30 Calls/Tag | Local Mode + Tolerante Deaktivierung |
| Forecast.Solar | 12 Anfragen/h Free | 1× täglich abrufen |
| Smartfox kWh-Werte | Unzuverlässig | Nur Fronius nutzen |
| Browser → LAN | CORS-Block | Lokaler Collector-Service |
| Realtime | PGRST002-Fehler | 30–60s Polling stattdessen |
| AI Reward Self-Correction | Nicht möglich | Manuelle Reward-Updates |
| Batterie-Entladung | Smartfox/Fronius decken jede Hauslast zuerst aus der Batterie (bis Mindest-SOC); wir stellen dort nichts ein (Grundsatz §1) | nur über die Heizlast: Tagesmodus + Ladestand-Grenze ohne Ausnahme (`battery_gate`, Sonne zuerst in die Batterie) |
| Außentemperatur-Historie | `weather_data` erst ab 23.10.2026 | — |

---

## 19. Entscheidungsprotokoll

| Entscheidung | Begründung | Datum |
|---|---|---|
| Direkte Gemini API statt Lovable AI Gateway | Kostenkontrolle, Modell-Pinning | — |
| Polling 30–60s statt Realtime | PGRST002 Schema-Cache-Fehler | 2026-Q1 |
| Single-Household RLS (USING true) | Familien-App, kein Multi-Tenant | 2026-01-09 |
| Lokaler Collector | LAN-Geräte nicht extern erreichbar | initial |
| Dual-Modus (Cloud+Local) ohne Auto-Failover | User-Kontrolle über Quota-Strategie | 2026-Q1 |
| Tolerante Deaktivierung (Phase 1) | Tuya-Quota-Schonung bei wechselhaftem Wetter | 2026-04-19 |
| Batterie-Reserve 60% | Schutz Abendverbrauch, validiert via Cron | 2026-04 |
| `room_heating_logs` als Heiz-Wahrheit | `rooms.is_heating` veraltet manchmal | — |
| Solar-Gain-Logik entfernt | Thermostate handhaben passiv autom. | — |
| Battery-Protection-Modus entfernt (alt) – ersetzt durch Ladestand-Grenze `battery_gate` | Heizen darf Netz nutzen; seit 27.10.2026 begrenzt die Ladestand-Grenze die Heizlast, damit die Batterie für die Nacht bleibt | — / 2026-10-27 |
| Steuerung nur über die Thermostate | Keine Einstellungen an Smartfox/Fronius, die sich mit unserer Steuerung überkreuzen | 2026-11-01 |
| Komfort strikt = nur gridExport | Verhindert Netzbezug für Komfort-Heizen | — |
| Mikro-Budget mit Soft-Rotation | Verhindert Cooldown-Kollision | — |
| Hysterese 0.3/0.2°C | Anti-Flapping ohne Komfort-Verlust | — |
| Thermostate im Modus „home“ statt „auto“ | Nur so wirken die Sollwerte der Automatik; Wochenprogramm mit falscher Uhr | 2026-10-24 |
| Tagesmodus statt „Tag → Eco halten“ | Räume ohne Budget heizten sonst sofort aus Batterie/Netz (9,6 kW am 27.10. 08:00) | 2026-10-27 |
| Mindesttemperatur „Untergrenze“ je Raum | Eigener Einstellwert statt Nachtwert als Tagesuntergrenze | 2026-10-27 |
| Max. Heizleistung ohne PV | Netzheizen nur nach Priorität und begrenzt | 2026-10-27 |
| KI verschiebt Wartetag-Schwelle | Mustergedächtnis entscheidet mit, Grundregeln bleiben ohne KI funktionsfähig | 2026-10-27 |
| Abwesend = jeder Tag ein Wartetag, keine eigene Absenk-Temperatur | Haus sehr träge (Zeitkonstante ~250–400 h): tiefere Temperatur spart nur 3–11 %; Hebel ist, ohne Bewohner kein Netz-Eco zu heizen | 2026-10-28 |

---

## 20. Changelog

> **REGEL:** Bei JEDER Änderung hier dokumentieren — Datum, was, warum.

### 2026-11-08 — Alarm-Mails: je Problem genau zwei, mit Lösungsansatz; Prüfliste Nebenwirkungen
- Befund: Büro-Thermostat offline seit 07.11. 16:48 → 17 Mails in 14 h (Pingpong „Gerätefehler“/„wieder in Ordnung“). Ursache: `system_problems()` las `api_errors`; die werden nach 2 h (`auto-resolve-api-errors`) bzw. beim bloßen Einreihen eines Befehls (`pv-automation`, Lokal-Modus) geschlossen, obwohl das Gerät weg ist.
- `system_problems()`: Thermostate einzeln aus `thermostat_state.read_at` (nur echte Lesungen), übrige Fehler je Quelle + Art. SQL 27.
- `system-alert`: Problem-Mail mit „Was tun“, Gelöst-Mail erst nach 15 min am Stück ohne Problem, keine 24-h-Erinnerung.
- Neu im Kopf dieser Doku: Pflicht-Prüfliste Nebenwirkungen. Details `doc/FIX-ALERT-MAILS-2026-11-08.md`.
- Offen (TODO): `pv-automation` meldet im Lokal-Modus „erreichbar“ ohne Antwort.

### 2026-11-06 — Heizplaner im Schattenbetrieb
- Uli: ständig feste Werte, die nicht funktionieren – die KI soll das beste Modell finden. Entscheidung: rechnender Planer statt Regeln, zuerst im Schatten.
- Raummodell je Raum (k, g, s, c, τ) aus 24-h-Simulation gelernt, Prior für Räume mit wenig Daten; PV je Stunde aus Strahlung inkl. Bergschatten, Nachführung; Batterie; gieriger Planer 24 h × halbe Stunde.
- Prüfung 05.11.: Modell mit echter Heizung 0,28 °C Abweichung; Planer bei gleichem Strom 0,6 statt 34 °C·h unter Untergrenze.
- Edge Function `heizplaner`, SQL 25, `analysis-scheduler`, App KI › Planer, Einstellungen Planer. Konzept `doc/KONZEPT-PLANER-2026-11-06.md`.

### 2026-11-06 — Kontrolle über die Heizleistung
- Befund: Raumleistungen geschätzt (Wirtschaftsraum 700 statt ~2050 W, Haustür/Toilette leer), automatische Messung lief nie, Grenze am Tag (Untergrenze hart) und nachts (einmaliger Push) wirkungslos – 05.11. Wohnzimmer 5,5 kW aus Batterie/Netz, Nacht 03./04.11. 7–11 kW.
- Raumleistungen auf Messwerte gesetzt (13 Tage, Regression, mittl. Abweichung 73 W).
- `measure-room-power` täglich 09:30, Vorschläge in KI › Zu entscheiden (Whitelist `heating_power_w`), SQL 24.
- `pv-automation`: „Grenze gilt immer“ – Tag und Nacht unter der Grenze, Raum über der Grenze heizt allein, Wartezeit-Vorrang, Nachlauf zählt mit.
- Übersicht: Karte „Heizung jetzt“ (gemessen vs. laut Thermostaten, Grenze, kWh heute), Raumkarte mit Leistung, „seit“, „heute“. Details `doc/FIX-HEIZLEISTUNG-2026-11-06.md`.

### 2026-11-02 — Eco als Ziel, Raummodell
- Befund: 02.11. morgens Zimmer Uli 20 °C bei Eco 22 °C; Batterie-Schutz (SOC < 75 %) hielt alle Räume auf „Untergrenze − 1 °C“.
- Uli: „Eco ist das Ziel“, fester Tarif, PV zu 100 % nutzen, Winter/Sommer und unterschiedliches Auskühlen berücksichtigen.
- `pv-automation`: Tagesart (Sonnentag/schlechter Tag) vor dem Gate, mit Abzug „Batterie bis voll“; Batterie-Schutz nur an Sonnentagen; schlechter Tag und Abend → Eco nach Priorität aus Batterie/Netz; Nacht `maintain` mindestens Untergrenze; Notfall-Abstand Standard 0; Vorausschau aus Raummodell sortiert gleiche Priorität nach Nachtbedarf.
- `fetch-weather`: Nachtrag aus dem Open-Meteo-Archiv (`backfill_from`).
- SQL `17_eco_ziel.sql` (Abstand 0, Tagesnote nach Eco/Zeitpunkt des Netzbezugs), `18_raummodell.sql` (Auskühlen je Raum, Cron 09:55).
- App: Protokoll › Raummodell (Knopf „Außentemperaturen nachtragen und neu berechnen“), Tagesnoten-Texte, Einstellung Notfall-Abstand Standard 0.
- Konzept `doc/KONZEPT-RAUMMODELL-2026-11-02.md`, Tagesablauf §11.

### 2026-10-28 — Batterie-Vorschlag ändert nur noch den Mindest-Ladestand
- Befund: KI-Batterie-Vorschläge 23.–28.10. täglich übernommen → `heating_min_battery_soc` 50 → 90 %. Begründet auf den Fehltagen 24.–27.10. (morgens alle Räume aus der Batterie). Beim Übernehmen setzte `battery-soc-decision` zusätzlich `battery_reserve_for_night_soc` auf denselben Wert → Batterie-Puffer und Mikro-Budget (brauchen Reserve + 20 %) praktisch aus; Batterie-Gate bei 88 % aktiv.
- Werte von Uli zurückgesetzt: Mindest-Ladestand 75 %, Nacht-Reserve 60 %.
- Fix: `battery-soc-decision` schreibt nur noch `heating_min_battery_soc`. Die Vorschlagsregel (`ai-parameter-advisor` /suggest-battery-soc, feste Wenn-dann-Regel, kein Gemini) bleibt unverändert – nach 2–3 Wochen prüfen, ob sie im Winter nur nach oben zieht (Prognose < 10 kWh → anheben, Senken erst > 20 kWh).

### 2026-11-01 — Altdaten gelöscht
- Tagesnote Teil Komfort korrigiert (war immer 0: Summe aller Räume gegen 720 min eines Raums). Jetzt Anteil an Räume × Fensterminuten. SQL `16_tagesnote_komfort_fix.sql`.
- Lerndaten vor dem 26.10.2026 gelöscht/geleert (learning_events, room_ml_features, room_heating_logs, Heiz-Kennzahlen im Mustergedächtnis, berechnete Raumwerte). SQL `15_altdaten_loeschen.sql`.

### 2026-11-01 — Lernschleife Stufe 1 + 2
- `learning_data_since` = 26.10.2026, `update-learned-policies` lernt nur ab dann, `learned_policies` geleert. Tagesnote `tages_bewertung` (21:55 Einstellungen, 09:55 Bewertung), Tab Protokoll › Tagesnoten, Batterie-Vorschlag nennt den bestbewerteten ähnlichen Tag. SQL `14_lernschleife.sql`. Konzept `doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md`.

### 2026-11-01 — Batterie-Vorschlag mit Nachtbedarf und Mustergedächtnis
- Alte Regel hätte am 01.11. 75 → 85 % vorgeschlagen (trüber Tag → Grenze hoch). Neu: gemessener Nachtbedarf + Abend/Morgen + Reserve, Mustergedächtnis für realistische PV und Heiz-Anteil. SQL `13_batterie_vorschlag.sql` (`battery_night_reserve_pct`). Konzept Tagesablauf §10.

### 2026-11-01 — Batterie-Schutz ohne Lücken
- Befund: Batterie mittags nur bis ~14 %, nachmittags wieder auf 5 %. Lücke 1: Gate öffnete, sobald PV die Batterie lud. Lücke 2: im Batterie-Schutz bis 2000 W für Räume unter Untergrenze (kam aus PV/Batterie).
- `pv-automation`: Gate = `SOC < heating_min_battery_soc`; strict-Budget nur echte Einspeisung; Ziel Untergrenze − `battery_gate_floor_delta`, Notfall bis `battery_gate_max_power_w`. SQL `12_batterie_schutz.sql` (zwei neue Werte, Protokoll-Energie mit Leistungs-Ersatzwert 800 W). Konzept Tagesablauf §3.4 + §9.

### 2026-11-01 — Doku bereinigt
- Grundsatz „Steuerung nur über Thermostate“ (§1, §19); Smartfox bleibt Energiemanager (Batterie, Warmwasser, Auto), nur seine Daten werden nicht genutzt.
- §2 Vorzeichen auf Fronius korrigiert; §10 Thermostat-Dienst auf den echten Stand v1.4; §18 Fronius-Zeitsteuerung gestrichen.
- `doc/memory/anwesenheit.md` und `tuya-local-service-implementation.md` an den Ist-Stand angepasst; TODO bereinigt.

### 2026-11-01 — Anwesenheit umgedreht: Kalender = Abwesenheit
- Befund (Uli): Räume kühlen bei „abwesend“ zu stark aus; vergessene Einträge machen das Haus „leer“.
- Grundzustand jetzt anwesend, Einträge in `presence_periods` = Abwesenheit, Vorlauf vor der Rückkehr. SQL `09_abwesenheit_umdrehen.sql` (löscht die alten Aufenthalts-Einträge).
- Bei Abwesenheit wieder Komfort mit PV-Überschuss (Phase 2, kein Eco-Deckel – Entscheidung 30.10.2026).
- App: „Ich bin weg bis …“ / „Ich bin zurück“, Kalender mit Abreise/Rückkehr. Alexa (`heizung-muenchen`) muss nachgezogen werden.

### 2026-10-28 — Anwesenheit (Kalender + Schnellschalter)
- Neu: Tabelle `presence_periods`, `heating_settings.presence_control_enabled` / `presence_lead_hours` (SQL `07_anwesenheit.sql`).
- `pv-automation`: abwesend → Tagesmodus `wait`, kein Komfort, höchstens Eco (§4 Anwesenheit). Fail-safe anwesend.
- App: Karte „Anwesenheit“ in der Übersicht (Ich bin da bis … / Ich bin weg), Einstellungen › Anwesenheit (Kalender), Haus › Anwesenheit (an/aus, Vorlauf).
- Messung Auskühlung und Ersparnis: `doc/KONZEPT-ANWESENHEIT-2026-10-28.md` §2.

### 2026-10-27 — Grundkonzept Tagesablauf, Tagesmodus, drei Steuerfehler behoben
- Anlass: seit 24.10. jeden Morgen um 08:00 bis 9,6 kW Heizlast, Batterie täglich 57 → 5 %, Auto und Warmwasser ohne Überschuss. Ursache: Thermostate folgen seit Dienst v1.3 („home“) erstmals den Sollwerten; die Logik setzte tagsüber jeden Raum ohne Budget auf Eco.
- Grundkonzept festgeschrieben: `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`.
- Neu: Tagesmodus `battery_gate` / `wait` / `grid` (§4 Stufe 3b), `rooms.wait_min_temp` („Untergrenze“), `max_grid_heating_power_w` wieder wirksam, KI-Schwelle über Mustergedächtnis.
- Behoben: Batterie-Gate und Raumschleife schrieben gegeneinander (Pingpong Nacht/Eco alle 5 Min); „Eco=Nacht → direkt Komfort“ umging das Komfort-Budget; Komfort-Upgrade ohne Eco-Budget; `set_mode` scheiterte immer.
- SQL: `supabase/SQL/06_tagesmodus_mindesttemperatur.sql`. Deploy: `supabase functions deploy pv-automation`.
- Doku bereinigt: Nachtzeiten, SOC-Schwellen, Hard-PV-Gate-Werte, DP-Mapping, Takt 5 Min.

### 2026-10-26 — Neue Tab-Struktur, Analyse mit Einstellungs-Vorschlägen
- 4 Tabs nach Zweck: Übersicht · Analyse · KI · Einstellungen. Energie, Heizung & KI, Verlauf & Muster aufgelöst; jede der 30 Karten hat einen Platz (Umzugsliste).
- Analyse: Tag (7 Tage) / Woche / Monat / Jahr; Tagesbilanz aus 5-Min-Werten und Thermostat-Samples; „Das Wichtigste“ mit regelbasierten Vorschlägen (PV-Schwelle EIN, Nacht-Heizmodus) – nur abgeschlossene Tage, nur Whitelist, Anwenden nach Bestätigung mit Wertvergleich, Protokoll in `ai_parameter_decisions`.
- KI-Tab bündelt alle Vorschläge (Zähler am Tab); Parameter-Vorschläge mit Ablehnen. KI-Einstellungen (Autopilot, Modus je Parameter, Mustergedächtnis, Zeitplan) unter Einstellungen › KI. Heiz-Reihenfolge per ▲▼.
- Gemeinsamer Anwende-Weg `src/lib/aiParameters.ts`; `parallel_heating_capacity` aus der Whitelist wird nicht angewendet (kein Grenzwert, sondern Heizplan).
- Details: `doc/NEUE-TAB-STRUKTUR-2026-10-26.md`

### 2026-10-26 — Heizzyklen per Datenbank-Trigger
- Trigger `trg_log_room_heating_transition` auf `rooms.is_heating` schreibt `heating_start`/`heating_stop` (mit Dauer, Energie, Überschuss) – unabhängig von RLS und vom Steuermodus; Duplikat-Schutz über offenen Start. Vorher fehlten alle Zyklen (falsches DP bis 24.10., danach RLS).
- Details: `doc/FIX-HEIZZYKLEN-TRIGGER-2026-10-26.md`

### 2026-10-26 — Thermostat-Steuerung aufgelöst
- Karte „Thermostat-Steuerung“ (Heizung & KI) entfernt; Funktionen umgezogen: Übersteuern → Übersicht, Automatik-Schalter → Einstellungen › Räume, Alle senden / Cloud lesen → Einstellungen › Betrieb (`settings/ThermostatMaintenance.tsx`). Cloud- und Lokal-Weg vollständig erhalten.
- `automation_enabled` ist der Hauptschalter (pv-automation lädt nur `true`) – vorher als „Auto-Empfehlung (KI)“ falsch beschriftet. Neue Räume werden mit Automatik an angelegt.
- `usePushAllTemps` (Lokal) setzt kein `last_thermostat_sync` mehr – verdeckte sonst Offline-Fehler in `auto-resolve-api-errors`.
- Übersicht zeigt „Estrich-Speicher“ und „Solar bis …“.
- Entfernt: `ThermostatCard`, `StatusLegend`, `useAutomation`, `RoomManager`, `HeatingSettingsForm`.
- Details: `doc/THERMOSTAT-STEUERUNG-AUFGELOEST-2026-10-26.md`

### 2026-10-23 — Übersicht & Einstellungen im München-Aufbau, Wetter-Job, Battery-Full-Grenzen
- App heißt „Heizung Venediger“. Neue Startseite `overview/HouseOverview.tsx` (Modus, Energie, Wetter/Prognose, Raumkarten).
- Einstellungsseite neu: Betrieb · Haus · Räume · System. Speichern **nur geänderter Felder** mit Konfliktprüfung (`src/lib/safeSave.ts`, `useHeatingSettings.saveSettings`, `useRooms.updateRoomFields`). Raum löschen nur mit Namens-Bestätigung.
- pg_cron `fetch-weather-hourly` (xx:05) neu angelegt – `weather_data` war seit der Migration leer.
- `rooms.pv_boost_max_temp` in 5 Räumen geleert (lag ≤ Komfort → Battery-Full-Override wirkungslos). Grenze jetzt überall Komfort + 1,5 °C (Code-Fallback).
- Ausgeblendet ohne Wirkung: `max_grid_heating_power_w`, `pv_boost_temp_delta`; Strompreise nur noch unter Tarife.
- PWA-Update-Fix: `workbox.skipWaiting: true` (vorher blieb der neue Service Worker auf dem Handy dauerhaft „waiting“), `vercel.json` no-cache für sw.js/manifest/index.html.
- Details: `doc/UEBERSICHT-UND-EINSTELLUNGEN-2026-10-23.md`

### 2026-04-19 — Tolerante Deaktivierung (Phase 1)
- `pv-automation/index.ts`: Phase-1-Loop um Toleranz-Block erweitert
- Bedingungen: `isCurrentlyHeating` + `pvSufficientForEco` + `pvTrend ≥ -200` + `overshoot ≤ max(300, hp×0.4)`
- Logging: `[TOLERANT-DEACTIVATION]`, `[TUYA-QUOTA-RUN]`
- Memory: `mem://arch/pv-automation-budget-logic-v2` aktualisiert

### 2026-04 — Batterie-Reserve für Nachverbrauch
- 4 neue Felder in `heating_settings`: `battery_reserve_for_night_soc`, `battery_buffer_enabled`, `battery_buffer_bonus_w`, `tolerant_deactivation_enabled`
- Neue Tabelle `battery_daily_tracking` (date unique) mit RLS für Anon-Collector
- Neue Edge Function `validate-battery-reserve` (pg_cron 09:05)
- UI: `BatteryReserveStatus`-Widget + Settings-Card
- PV-Trend Bonus +300W bei Trend > +500W (5-Min-Vergleich)
- Mikro-Budget Untergrenze dynamisch: `max(micro_min_soc, reserve+20)`
- Batterie-Puffer gestuft (30/60/100%) mit Doppel-Gate

### 2026-Q1 — 4-Stufen-Logik & Predictive Planning
- `pv-automation`: kumulatives Budget statt Momentaufnahme
- Phase 1 (Eco) für alle Prio-Räume vor Phase 2 (Komfort)
- Forecast-basierte Eco-Bonus-Tiers (1500/800/400W)
- Hard PV Gate (<500W + <5kWh)

### 2026-01-12 — Heizungstyp-Konsistenz
- `analyze-patterns`: alle 5 Modi übergeben `heating_type`
- Wärmepumpen-Tipps bei `direct_electric` eliminiert

### 2026-01-09 — RLS-Hardening
- 18 Tabellen einheitliche Authenticated-Policy
- Spalten-Schutz Trigger für `rooms.tuya_device_id`/`local_key`
- Anon-Policies gezielt für Collector-Tabellen

### Initial / laufend
- PV-Automatik mit Hysterese
- Tuya TGP508 Cloud + Local Integration (Port 6668)
- PWA + Service Worker
- Lokaler Collector (Python + Node.js)
- ML-Feedback-Loop (`learned_policies`, daily 19:30)
- Heatmap & Energie-Breakdown UI
- Mikro-Budget mit Soft-Rotation
- Tuya-Quota-Schutz (5 Mechanismen)

---

## 📌 Quick-Reference für Memory-Files

Detaillierte Spec-Dateien unter `mem://`:
- `arch/pv-automation-budget-logic-v2` — Budget-Mathematik
- `arch/pv-automation-strategy-v2` — Phase 1/2 Reihenfolge
- `arch/automation-heartbeat-architecture` — 2-Min pg_cron
- `features/heating/four-stage-pv-optimization-logic` — 4 Stufen
- `features/heating/safety-gate-low-pv-logic` — Hard PV Gate
- `features/heating/night-frost-protection-mode` — Nacht-Modi
- `features/heating/thermostat-hysteresis-logic` — 0.3/0.2°C
- `features/heating/dual-control-mode-architecture` — Cloud/Local
- `integration/tuya/api-quota-management-v2` — Quota-Schutz
- `integration/tuya-tgp508-dps-mapping` — DPS-Codes
- `data-pipeline/ml-feature-extraction-logic` — Zyklus-Rekonstruktion
- `arch/timezone-standardization` — Europe/Vienna

**Vollständiger Index:** `doc/memory/index.md`
