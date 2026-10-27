# Konzept: Tagesablauf und Regeln der Heizungssteuerung Venediger

**Stand:** 27. Oktober 2026 · **Status:** FREIGEGEBEN (Uli, 27.10.2026) – umgesetzt, Testphase einige Tage
**Supabase:** `pflnniklvqbwjwrjswaz` · **Betrifft:** `pv-automation`, `heating_settings`, `rooms`, Thermostat-Dienst

> Dieses Dokument legt fest, **wie die Heizung arbeiten soll**. Der Code folgt ihm seit 27.10.2026
> (Abschnitt 8), `SYSTEM_DOCUMENTATION.md` ist nachgezogen.
> Regel aus der Master-Doku: *Konzept ist die Wahrheit – Code wird daran angepasst.*

---

## 1. Grundsätze

1. **Batterie gehört der Nacht.** Smartfox/Fronius regeln die Ladung autonom: erst Batterie, dann
   je nach Lage Auto und/oder Warmwasser. Die Heizung soll die Batterie tagsüber nicht leerziehen.
2. **Eco ist die Tagesgrundeinstellung.** Ist kein PV-Überschuss zu erwarten, wird Eco auch aus dem
   Netz gehalten – aber **nach Priorität und mit begrenzter Netzleistung**.
3. **Ist Überschuss absehbar, wird gewartet.** Zeigt die PV-Prognose, dass der Überschuss kommt,
   wird morgens nicht aus dem Netz geheizt. Die Räume warten, bis der Überschuss da ist – fallen
   aber nie unter ihre **Mindesttemperatur ohne PV**.
4. **Überschuss wird nach Priorität verteilt:** erst alle Räume auf Eco, dann mit weiterem
   Überschuss nach Priorität auf Komfort. Komfort nur mit echter Einspeisung.
5. **Nachts werden die Räume heruntergeschaltet**, morgens wird neu bewertet.
6. **KI und Muster** entscheiden innerhalb der Regeln mit: Das Mustergedächtnis (ähnlichster
   vergangener Tag) verschiebt die Grenze zwischen Wartetag und Schlechtem Tag und hebt Budgets an
   (z. B. Vorheizen vor einer PV-Spitze). Die Regeln 1–5 funktionieren auch ohne KI und werden von
   ihr nie aufgehoben.
7. **Alle Werte sind einstellbar.** Feste Zahlen im Code sind nur Rückfallwerte.

---

## 2. Tagesablauf

| Phase | Zeitraum | Was passiert |
|---|---|---|
| **Nacht** | `night_start_time` (22:00) → `night_end_time` (08:00) | Einmaliger Befehl je Nacht: alle Räume auf Frostschutz (`night_heating_mode = frost_only`) bzw. Nachtwert (`maintain`). Danach Ruhe. |
| **Morgenbewertung** | ab `night_end_time`, bei jedem Lauf neu | Prognose: Reicht der heute noch erwartete PV-Überschuss für den Eco-Bedarf aller Räume (Verhältnis ≥ Schwelle 1,0 ± KI)? → **Wartetag** oder **Schlechter Tag**. Liegt die Batterie unter dem Gate → **Batterie-Schutz** |
| **Wartetag** | bis Überschuss da ist | Räume halten ihre **Mindesttemperatur ohne PV**. Fällt ein Raum darunter, wird nur bis zu dieser Grenze geheizt (nach Priorität, Netzleistung begrenzt). |
| **Schlechter Tag** | ganzer Tag | Eco als Grundeinstellung aus dem Netz, **nach Priorität**, Summe der Raumleistungen ≤ **max. Netz-Heizleistung**. Weitere Räume warten, bis ein Raum Eco erreicht hat. |
| **Überschuss Phase 1** | solange Einspeisung ≥ Ein-Schwelle | Räume nach Priorität auf Eco, so weit das PV-Budget reicht. |
| **Überschuss Phase 2** | alle Räume auf Eco + weiter Einspeisung | Räume nach Priorität auf Komfort, nur mit echter Einspeisung. Erreicht ein Raum Komfort → zurück auf Eco (Estrich-Speicher). |
| **Abend** | bis `night_start_time` | Kein Überschuss mehr → Regeln wie „Schlechter Tag“, Batterie bleibt für die Nacht. |

**Wechsel zwischen Wartetag und Schlechtem Tag:** Die Bewertung läuft bei jedem Lauf neu, mit
der korrigierten Restprognose (`forecastAccuracy`). Bricht die Prognose im Tagesverlauf ein, wird
aus dem Wartetag ein Schlechter Tag.

---

## 3. Regeln im Detail

### 3.1 Mindesttemperatur ohne PV (neu)
- Neuer Wert **je Raum** `rooms.wait_min_temp`, in Einstellungen › Räume als **„Ohne PV“**.
  Startwert: Eco − 1,5 °C (SQL `06_tagesmodus_mindesttemperatur.sql`), danach von Uli anzupassen.
  Leeres Feld = Eco − 1,5 °C.
- Gilt am Wartetag und als Ziel des Batterie-Gates (3.4).
- Validierung in der App: 5 °C ≤ „Ohne PV“ ≤ Eco ≤ Komfort.
- Räume unter ihrer Mindesttemperatur werden **in jedem Modus zuerst** bis zur Mindesttemperatur
  geheizt, nach Priorität und innerhalb der Netzgrenze (3.2). Passt ein Raum nicht mehr hinein,
  wartet er: Sollwert knapp unter Ist (heizt nicht an), bis Kapazität frei wird.
- Löst den bisherigen Missbrauch des Nachtwerts als „Tagesuntergrenze“ ab.

### 3.2 Max. Netz-Heizleistung
- Wert `heating_settings.max_grid_heating_power_w` (existiert, Standard 2000 W, wird heute gelesen aber **nicht verwendet** und ist in der UI ausgeblendet). Wird wieder eingeblendet und wirksam.
- Begrenzt am Schlechten Tag und beim Heizen auf die Mindesttemperatur die Summe der gleichzeitig heizenden Räume.
- Räume werden nach Priorität zugelassen; ein Raum, der nicht mehr hineinpasst, wartet.

### 3.3 Überschuss-Heizen (unverändert, Phase 1 und 2)
- Budget, Ein-/Aus-Schwelle, Toleranz, Prognose-Bonus, Trend, Mikro-Budget, Estrich-Sättigung
  wie in `SYSTEM_DOCUMENTATION.md` §4–§8 beschrieben.
- **Neu:** Ein Raum ohne Budget fällt **nicht** automatisch auf Eco zurück, sondern auf das, was die
  Tagesbewertung vorgibt (Wartetag → Mindesttemperatur, Schlechter Tag → Eco innerhalb der Netzgrenze).

### 3.4 Batterie-Gate
- `heating_min_battery_soc` (aktuell 75 %), Modus `heating_soc_gate_mode` (aktuell `strict`).
- Fällt der Ladestand unter die Grenze, werden alle Räume auf die **Mindesttemperatur ohne PV**
  zurückgesetzt (bisher: Nachtwert). **Keine andere Regel darf das im selben Lauf überschreiben.**
- Komfort ist unterhalb der Grenze immer gesperrt.

### 3.5 Wichtige physikalische Einschränkung (zur Kenntnis)
Die Software entscheidet nur, **ob** ein Thermostat heizt. **Woher** der Strom kommt, entscheidet
der Fronius: Heizt ein Raum ohne Überschuss, entlädt er zuerst die Batterie, erst danach kommt
Netzstrom. „Eco aus dem Netz“ heißt in der Praxis also „Eco aus Batterie, dann Netz“. Die
Batterie wird nur geschützt, indem die Heizlast selbst begrenzt wird (Netzgrenze 3.2, Batterie-Gate
3.4). Ob der Fronius tagsüber das Entladen sperren kann (zeitabhängige Batteriesteuerung), ist
**offen** (siehe 6).

### 3.6 KI und Muster
- **Mustergedächtnis entscheidet über den Tagesmodus mit:** Ist der ähnlichste vergangene Tag
  (`best_match_today`, Qualität exact/partial) gut aus PV gedeckt worden (≥ 60 %), sinkt die
  Schwelle für den Wartetag; war er kaum gedeckt (< 30 %), steigt sie. Verschiebung
  = `pattern_recall_strength`/100 × 0,3 × Qualitätsfaktor (exact 1,0 / partial 0,6), also max. ±0,3.
  Schwelle bleibt zwischen 0,5 und 1,5. Ohne passendes Muster gilt 1,0.
- Dürfen Budgets anheben (Vorheizen vor PV-Spitze, Muster-Bonus) und die Reihenfolge innerhalb
  gleicher Priorität beeinflussen.
- Dürfen **nicht**: Wartetag/Schlechter Tag umgehen, Netzgrenze überschreiten, Batterie-Gate
  aufheben, Nacht- und SOC-Grenzen ändern (`LOCKED_PARAMS`).

---

## 4. Einstellwerte

### 4.1 Wirksam und einstellbar (bleibt)

| Wert | Tabelle | Aktuell | Bedeutung |
|---|---|---|---|
| `night_start_time` | heating_settings | 22:00 | Beginn Nacht |
| `night_end_time` | heating_settings | 08:00 | Tagesstart / Morgenbewertung (am 01.07.2026 über die App gesetzt) |
| `night_heating_mode` | heating_settings | frost_only | Nacht: Frostschutz oder Nachtwert halten |
| `heating_min_battery_soc` | heating_settings | 75 % | Batterie-Gate |
| `heating_soc_gate_mode` | heating_settings | strict | Gate-Verhalten |
| `pv_surplus_threshold_on/off` | heating_settings | 500 / – W | Ein-/Aus-Schwelle Überschuss |
| `floor_heating_response_hours` | heating_settings | 2 h | Vorlauf für Prognose-Boni vor Tagesstart (Untergrenze 06:00 fest) |
| `power_budget_tolerance_w`, `room_rotation_minutes`, `min_room_pause_minutes`, `min_switch_interval_min` | heating_settings | – | Budget-Toleranz, Rotation, Pausen |
| `battery_buffer_enabled/bonus_w`, `tolerant_deactivation_enabled`, `micro_budget_enabled`, `micro_heat_duration_min`, `pattern_recall_strength` | heating_settings | – | Boni und Sonderregeln |
| `eco_temp`, `comfort_temp`, `night_temp`, `priority`, `heating_power_w`, `automation_enabled`, `manual_override_until`, `pv_boost_max_temp` | rooms | je Raum | Raumwerte |

### 4.2 Neu oder wieder wirksam (seit 27.10.2026)

| Wert | Tabelle | Anzeige in der App | Standard |
|---|---|---|---|
| **`wait_min_temp`** | rooms | Einstellungen › Räume › „Ohne PV“ | Eco − 1,5 °C |
| **`max_grid_heating_power_w`** | heating_settings | Einstellungen › Haus › Verteilung › „Max. Heizleistung ohne PV“ | 2000 W (0 = ohne PV gar nicht heizen) |
| `pattern_recall_strength` | heating_settings | Einstellungen › KI › Mustergedächtnis | 50 – wirkt jetzt zusätzlich auf den Tagesmodus |

### 4.3 Fest im Code – sollen einstellbar werden (`pv-automation/index.ts`, Zeilen Stand 27.10.)

| Wert | Zeile | Bedeutung |
|---|---|---|
| Frostschutz 5 °C | 811 | Nacht-Sollwert bei `frost_only` |
| Harte PV-Sperre: PV < 300 W **und** Prognose < 8 kWh | 3051–3052 | kein Heizen an sehr schlechten Tagen (Doku nennt 500 W / 5 kWh) |
| PV-optimierter Modus ab PV > 500 W | 1540 | Umschalten der Budget-Berechnung |
| Grundlast 500 W | 1359 | Abzug in Prognose-Rechnung |
| Prognose-Fenster ab 06:00, Startgenauigkeit 0,7 | 1315, 1352 | Korrektur der Restprognose |
| Prognose-Bonus 1500/800/400 W bei Ratio 3/2/1,5 und SOC 50/60/70 % | 1609–1615 | Eco-Bonus |
| Trend-Faktor 0,5, max. ±1500 W | 1643 | Eco-Budget |
| Grundlast-Puffer 200–1500 W (σ × 1,5) | 1665 | Komfort-Schutz |
| Batterie voll 95 %, Prognose ≥ 10 kW | 1713–1714 | Komfort-Bonus |
| Battery-Full-Override 95 %, 3000 W, 5 kWh | 2436–2440 | Estrich-Sättigung überstimmen (die KI-Whitelist-Werte `comfort_override_*` werden **nirgends gelesen**) |
| Übertemperatur-Abstand 0,4 °C, Hysterese 0,3 °C | 2917 u. a. | Sicherheits-Stopp |
| Mikro-Budget-SOC = Gate + 5 % (`micro_budget_min_battery_soc` wird ignoriert) | 2254 | Mikro-Budget |
| Vorheiz-Bonus 800 W, Speicher-Bonus 500 W | 1887, 1891 | KI-Signal |
| Wochen-Bonus 600 W, Eigenverbrauch 60 % → × 0,7 | 1913, 1917 | KI-Wochenauswertung |
| Muster-Bonus bis 400 W, Fenster 10–14 Uhr | 1940, 1951 | Mustergedächtnis |
| KI/Policy-Aktivierung erst ab PV 500 W | 3095, 3170 | ML-Gate |

---

## 5. Abweichungen Code ↔ Konzept (Befunde 27.10.2026)

### 5.1 Warum es mit „auto“ funktioniert hat und mit „home“ nicht
- `learning_events` zeigt für **19.–22.10.** jeden Morgen um 08:00 dieselben Befehle wie heute:
  „Budget-Stopp → Eco 19–22 °C“ (je 30 Entscheidungen). Der Verbrauch blieb trotzdem bei ~200 W.
- Grund: Bis v1.1 schrieb der Dienst nur die Solltemperatur (DP 2); der Modus-Befehl ging auf DP 1
  (Ein/Aus). Die Thermostate blieben in **„auto“** (Wochenprogramm) und überschrieben die Sollwerte.
- Seit **24.10. (v1.3)** setzt jeder Sollwert den Modus **„home“**. Ab da wirkt die Logik erstmals –
  Morgenverbrauch 08:00 seitdem 3–9 kW, Batterie täglich auf 5 %.
- **Fazit:** v1.3 ist richtig. Die Fehler unten waren schon immer im Code, aber unsichtbar.

### 5.2 Fehler 1 – Budget-Stopp setzt tagsüber immer Eco
`pv-automation` Zeilen 3250–3258: Raum ohne Budget → „Tag → eco_temp halten“. Damit heizt jeder
Raum aus Batterie/Netz, unabhängig von der Prognose. Widerspricht Grundsatz 3. Am 27.10. 08:00
starteten so alle 12 Räume gleichzeitig (Summe 9,6 kW).

### 5.3 Fehler 2 – Batterie-Gate und Raumschleife schreiben gegeneinander
Das Gate (Zeilen 1806–1849) setzt Räume auf den Nachtwert, die Raumschleife im selben bzw.
nächsten Lauf wieder auf Eco. Ergebnis: Pingpong alle 5 Minuten (z. B. Bad Uli 22 → 21 → 22 °C),
269 statt 30 Entscheidungen am 24.10., Heizen läuft durch.

### 5.4 Fehler 3 – „Eco = Nacht → direkt Komfort“ ohne Budget
Zeilen 3305–3311: Ist Eco ≤ Nachtwert + 0,3 °C, springt der Raum auf **Komfort**, ohne das
Komfort-Budget zu prüfen. Betrifft Büro und Zimmer Uli (Eco 21 = Nacht 21), sichtbar seit 25.10.
(„direkt Komfort 23 °C“).

### 5.5 Weitere Befunde
- `set_mode` scheitert immer: `pv-automation` schreibt den Modus in `value_text`, der Dienst liest
  `value` → „Unbekannter Modus null“. Unnötig, da v1.3 den Modus beim Sollwert mitsetzt.
- `rooms.pv_auto_enabled` („PV-Automatik“ in den Einstellungen) wird von `pv-automation` **nicht
  ausgewertet** (nur in `/status` gelesen). Der Schalter hat keine Wirkung.
- Anzeige „heizt nein“ bei allen Räumen während 8–10 kW Verbrauch → Auswertung von DP 5 prüfen.
- **Eco höher als Komfort** in drei Räumen: Flur (Eco 22 / Komfort 20), Wohnzimmer (22/21),
  Haustür (22/21). Widerspricht „erst Eco, dann Komfort“ (nach Erreichen von Komfort fällt der Raum
  auf ein *höheres* Eco zurück). Die App lässt so einen Raum nicht mehr speichern, bis die Werte
  stimmen → von Uli zu korrigieren.
- Nebenbefund Code: Im ML-Cache-Block wird `heatingSettings` gelesen, die Variable existiert nicht
  (Zeile ~2812). Der Block läuft nur mit Tuya-Cloud-Zugangsdaten, wirkt im Lokal-Modus also nicht.
- Vergleich Auto-Modus (20./21.10.) und Home-Modus (25./26.10.): Tagesverbrauch ~11,5 kWh
  (Heizung ~6 kWh, fast nur 10–15 Uhr) gegen ~35 kWh (Heizung ~29 kWh, ab 08:00 und abends).
  Die Räume waren im Auto-Modus meist wärmer (z. B. Bad Uli 22,1 statt 21,3 °C). Wetter vermutlich
  milder; Außentemperaturen erst ab 23.10. gespeichert.
- Schutz-Trigger `protect_rooms_sensitive_columns` behandelt den SQL-Editor wie anon und setzt
  `eco_temp`/`comfort_temp` still zurück. Im SQL-Editor vorher
  `select set_config('request.jwt.claims','{"role":"service_role"}', false);` ausführen.

---

## 6. Offene Fragen

1. **Batterie tagsüber sperren?** Kann der Fronius (zeitabhängige Batteriesteuerung) das Entladen
   tagsüber verhindern? Dann käme „Eco aus dem Netz“ wirklich aus dem Netz. Solange nicht, gilt:
   Liegt die Batterie unter `heating_min_battery_soc` (75 %), läuft der Tag im Modus
   **Batterie-Schutz** – auch an schlechten Tagen wird dann nur die Mindesttemperatur gehalten,
   kein Eco. Nach der Testphase prüfen, ob das zu kühl ist.
2. ~~Name und Standardwert~~ → `wait_min_temp`, „Ohne PV“, Eco − 1,5 °C (entschieden 27.10.).
3. ~~Max. Netz-Heizleistung~~ → 2000 W als Startwert, einstellbar (entschieden 27.10.).
4. **Nachtwert:** Bei `frost_only` nur noch für `maintain`, als Untergrenze der KI-Empfehlungen und
   bei Rotation in der Nacht verwendet. Batterie-Gate und Mikro-Budget nutzen jetzt „Ohne PV“.

---

## 7. Doku-Bereinigung (erledigt 27.10.2026)

| Stelle | Steht dort | Richtig |
|---|---|---|
| SYSTEM_DOCUMENTATION §3, §9 | Nacht 22:00–06:00 bzw. „real 20:00–09:00“, Heizstart strikt 09:00 | `night_start_time`/`night_end_time`, aktuell 22:00–08:00 |
| SYSTEM_DOCUMENTATION §3, §9 | `target_battery_soc` 40 % als Morgen-Trigger, `min_battery_soc` 20 % | deprecated, nur `heating_min_battery_soc` wirkt |
| SYSTEM_DOCUMENTATION §4 | Hard PV Gate 500 W / 5 kWh | Code: 300 W / 8 kWh (→ einstellbar machen) |
| SYSTEM_DOCUMENTATION §10 | DP-Mapping `MODE='1'`, `HEATING='4'` | v1.3: DP 1 Ein/Aus, DP 4 Modus, DP 5 heizt |
| memory/night-frost-protection-mode.md | Nacht 20:00–08:00 | Einstellwerte |
| ARCHITECTURE.md | „kein Überschuss → eco_temp“ | Tagesbewertung nach Abschnitt 2 |

---

## 8. Umsetzung 27.10.2026

| Teil | Datei | Änderung |
|---|---|---|
| Datenbank | `supabase/SQL/06_tagesmodus_mindesttemperatur.sql` | Spalte `rooms.wait_min_temp`, Startwerte Eco − 1,5 °C, `max_grid_heating_power_w` = 2000 W falls leer |
| Steuerung | `supabase/functions/pv-automation/index.ts` | Tagesmodus (`wait` / `grid` / `battery_gate`) mit KI-Schwelle; Funktion `allocateDayTargets` (Mindesttemperatur, Eco nach Priorität, Netzgrenze); Räume ohne Budget bekommen das Tagesmodus-Ziel statt „Eco halten“; Kennzeichen `budgeted` je Raum; Batterie-Gate und Mikro-Ende auf „Ohne PV“; Sprung „Eco=Nacht → Komfort“ entfernt; Komfort-Upgrade nur mit echtem Eco-Budget; kein `set_mode` mehr; Tagesmodus-Ziele erzeugen keine `solar_limit_*`-Einträge; Protokoll `system_settings.heating_day_mode` |
| App | `src/components/settings/RoomsSection.tsx` | Feld „Ohne PV“ je Raum, Validierung, Hinweis zu „PV-Überschuss-Automatik“ |
| App | `src/components/settings/HouseSettingsCard.tsx` | „Max. Heizleistung ohne PV“ wieder sichtbar |
| App | `src/components/overview/HouseOverview.tsx` | Betriebsmodus zeigt den Tagesmodus |
| Typen | `src/types/room.ts`, `src/integrations/supabase/types.ts` | `wait_min_temp` |

**Geprüft:** Typprüfung `pv-automation` (Deno) – keine neuen Fehler (nur bekannte Altfehler: Quota-Typen, `mlFeatures`, `heatingSettings`; 38 statt 39).
`vite build` ok, `tsc` nur die 3 bekannten Altfehler. `allocateDayTargets` mit den Raumdaten vom
27.10. 08:00 durchgespielt: Wartetag → 1 Raum heizt (800 W) statt 12 (9,6 kW); Schlechter Tag →
Eco für Prio-Räume bis 1900 W von 2000 W; Batterie-Schutz → nur Räume unter „Ohne PV“; Netzgrenze
wird in keinem Fall überschritten.

### Testphase – woran man es erkennt

```sql
-- Tagesmodus und Ziel je Raum (alle 5 Min neu)
select value->>'mode' as modus, value->>'ratio' as verhaeltnis, value->>'threshold' as schwelle,
       value->>'ki_info' as ki, value->>'grid_used_w' as netz_w,
       (value->>'computed_at')::timestamptz at time zone 'Europe/Vienna' as stand
from system_settings where key = 'heating_day_mode';

-- Morgenverbrauch je Tag (Vergleich mit 25.–27.10.)
select (timestamp at time zone 'Europe/Vienna')::date as tag,
       round(avg(consumption) filter (where extract(hour from timestamp at time zone 'Europe/Vienna') between 8 and 9)) as w_08_09,
       round(min(battery_soc) filter (where extract(hour from timestamp at time zone 'Europe/Vienna') between 7 and 12)) as min_soc
from energy_readings where timestamp > now() - interval '7 days' group by 1 order by 1;
```

Erwartung: morgens kein Sprung auf 4–9 kW mehr, Batterie fällt vormittags nicht mehr auf 5 %,
Befehle je Raum deutlich weniger (kein Pingpong).
