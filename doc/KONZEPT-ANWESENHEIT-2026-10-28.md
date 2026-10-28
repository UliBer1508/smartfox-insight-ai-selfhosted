# Konzept (Entwurf): Anwesenheit – „Ich bin da / Ich bin weg“

**Stand:** 28. Oktober 2026 · **Status:** ENTWURF – Entscheidungen von Uli offen (Abschnitt 11)
**Supabase:** `pflnniklvqbwjwrjswaz` · **Betrifft:** `pv-automation`, `heating_settings`, `rooms`,
Mustergedächtnis/Analyse, App (Übersicht, Einstellungen)
**Baut auf:** `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md` (Tagesablauf, Tagesmodus)

> Grundsatz: Erst steht das Konzept, dann wird Code geändert. Dieses Dokument ändert noch nichts.

---

## 1. Problem

Die Steuerung heizt heute **immer so, als wäre jemand im Haus**:

| Situation | Heute | Bei leerem Haus sinnvoll? |
|---|---|---|
| Wartetag | Räume halten „Ohne PV“ (Eco − 1,5 °C), notfalls aus Batterie/Netz | nein – zu warm |
| Schlechter Tag / Abend | Eco nach Priorität aus dem Netz, bis 2000 W | nein – reine Verschwendung |
| Überschuss Phase 2 | Komfort nach Priorität | nein – niemand braucht Komfort |
| Nacht | Frostschutz 5 °C (einmaliger Befehl) | ja |
| Ankunft nach Abwesenheit | kein Vorwissen – Haus ist kalt oder wurde unnötig warm gehalten | Vorheizen fehlt |

Den kurzen Eingriff gibt es schon (Übersteuern 1–24 h in der Übersicht, `manual_override_until`),
für Tage oder Wochen Abwesenheit aber nicht. Zum Vergleich: Im Home-Modus lag die Heizung am
25./26.10. bei ~29 kWh/Tag (Konzept 27.10. §5.5) – der Netz- und Batterieanteil davon ist bei
leerem Haus weitgehend vermeidbar.

---

## 2. Drei Zustände

| Zustand | Bedeutung | Regeln |
|---|---|---|
| **Anwesend** | Jemand ist im Haus | unverändert: Tagesablauf-Konzept vom 27.10. |
| **Abwesend** | Haus ist leer | Abschnitt 3 – nur schützen, Überschuss optional als Wärmespeicher |
| **Ankunft vorbereiten** | Abwesend, Ankunft steht fest und rückt näher | Abschnitt 4 – rechtzeitig vorheizen, zuerst mit PV |

Der Zustand wird bei **jedem Lauf** von `pv-automation` neu bestimmt (wie der Tagesmodus) und
als `system_settings.presence_state` protokolliert, damit die Übersicht ihn anzeigen kann.

**Reihenfolge in der Steuerung:**
Sicherheit (Übertemperatur) → Übersteuern (Override) → Batterie-Gate → **Anwesenheit** →
Budget Phase 1/2 → Tagesmodus.
Ein manuelles Übersteuern gewinnt also auch während der Abwesenheit (z. B. wenn du aus München
einen Raum für Handwerker kurz warm haben willst).

---

## 3. Regeln bei Abwesenheit (Vorschlag)

1. **Neue Untergrenze „Abwesend“** je Raum (`rooms.away_temp`, leer = Hauswert
   `heating_settings.away_temp_default`). Vorschlag Startwert **12 °C**, Bad eventuell höher
   (Feuchte). Validierung: 5 °C ≤ Abwesend ≤ „Ohne PV“ ≤ Eco ≤ Komfort.
2. **Kein Tag/Nacht-Wechsel nötig:** Der Wert „Abwesend“ gilt rund um die Uhr. Nur wenn ein Raum
   darunter fällt, wird bis dorthin geheizt – nach Priorität und mit eigener, kleiner Netzgrenze
   (`away_max_grid_power_w`, Vorschlag 1000 W). Damit entfällt das tägliche Aufheizen am Morgen.
3. **Wartetag und Schlechter Tag entfallen** – es gibt nichts zu warten.
4. **Komfort ist gesperrt** (Phase 2 läuft nicht).
5. **PV-Überschuss** – einstellbar (`away_surplus_mode`):
   - `none` – nicht heizen, Überschuss geht in Batterie/Auto/Warmwasser/Netz
   - `wait_min` – Räume mit Überschuss bis „Ohne PV“ laden (Estrich als Speicher) – **Vorschlag**
   - `eco` – bis Eco laden
   Vorteil von `wait_min`: Das Haus kühlt kostenlos weniger aus, das Vorheizen vor der Ankunft
   wird kürzer und billiger. Die Batterie-Regel (Batterie gehört der Nacht, Smartfox lädt zuerst
   die Batterie) bleibt unverändert.
6. **Batterie-Gate** bleibt wie es ist.
7. **Abreise:** Mit Beginn der Abwesenheit wird sofort einmal „Abwesend“ an alle Thermostate
   gesendet. Wichtig für den Fehlerfall: Fällt danach der PC in Österreich aus, halten die
   Thermostate diesen Wert (sie behalten immer den letzten Sollwert).

---

## 4. Ankunft vorbereiten (Vorheizen)

**Eingabe:** Ankunftszeit (Datum + Uhrzeit), Ziel **Eco** (Standard) oder Komfort, optional
nur bestimmte Räume (Abschnitt 5).

**Vorlauf je Raum:**
- Rechnung: (Ziel − Ist) ÷ gelernte Aufheizrate `room_ml_features.heating_rate_deg_per_hour`
  × Sicherheitsfaktor (Vorschlag 1,3).
- Solange zu wenig Lerndaten da sind (Heizzyklen erst seit 26.10.2026 sauber erfasst):
  fester Vorlauf `preheat_fallback_hours` (Vorschlag 24 h, einstellbar).

**Strategie – zuerst Sonne, dann Netz:**
1. **PV-Fenster vor der Ankunft nutzen:** Liegt in den letzten 1–2 Tagen vor der Ankunft
   Überschuss in der Prognose, laden die Räume schon dann bis Eco (statt nur „Ohne PV“).
   Estrich speichert die Wärme – genau wie beim heutigen Estrich-Speicher.
2. **Rest aus dem Netz** im berechneten Vorlauf, nach Priorität, mit eigener Grenze
   `preheat_max_grid_power_w` (Vorschlag 2000 W). Ist die Zeit zu knapp, startet der Raum mit
   der höchsten Priorität zuerst.
3. **Die Nacht vor der Ankunft** ist keine Frostschutz-Nacht, wenn der Vorlauf in die Nacht fällt.
4. Ab Ankunftszeit gilt automatisch wieder **Anwesend**.

**KI und Muster (später):**
- Aufheizzeiten je Raum aus echten Vorheiz-Fällen lernen und den Sicherheitsfaktor anpassen.
- **Auskühlkurve** lernen: Wie schnell kühlt jeder Raum bei welcher Außentemperatur aus? Das
  gibt es heute noch nicht – Abwesenheiten sind die perfekte Messgelegenheit.
- KI darf den Vorlauf vorschlagen, aber **nicht** Abwesenheit, „Abwesend“-Werte oder
  Netzgrenzen ändern (`LOCKED_PARAMS` erweitern).

---

## 5. Räume und Profile (Stufe 2)

Auch wenn du da bist, werden nicht immer alle Räume genutzt (z. B. Zimmer Luis / Zimmer Luca,
wenn du allein kommst). Vorschlag: **Anwesenheitsprofile**

| Profil | Geheizt wie „anwesend“ | Rest |
|---|---|---|
| Allein | z. B. Zimmer Uli, Bad Uli, Büro, Wohnzimmer, Flur, Haustür | „Abwesend“ |
| Familie | alle Räume | – |

Ein Profil wird beim Eintragen der Ankunft gewählt. Umsetzung: Liste von Raum-IDs je Eintrag.

---

## 6. Woher weiß das System, ob du da bist?

| Stufe | Quelle | Richtung | Bewertung |
|---|---|---|---|
| 1 | **App – Schalter** in der Übersicht („Ich bin weg“ / „Ich bin da“) | beide | einfach, sofort |
| 1 | **App – Kalender** in Einstellungen › Anwesenheit (Abreise, Ankunft, Profil, Notiz) | beide | nötig fürs Vorheizen |
| 2 | **Handy im WLAN** – der Collector auf dem Österreich-PC fragt die FritzBox, ob dein Handy angemeldet ist | **nur → Anwesend** | fängt unangekündigte Ankunft ab; schaltet **nie** automatisch auf Abwesend (Handy aus = Haus kalt wäre gefährlich) |
| 3 | **Alexa** („Heizung auf Abwesend“) über die vorhandene Alexa-Bridge | beide | Komfort, später |
| 3 | **KI-Hinweis** aus dem Hausverbrauch (Grundlast ohne Heizung deutlich höher → vermutlich jemand da) | nur Hinweis | nie automatisch schalten |
| ? | Buchungen/Kalender anderer Nutzer | – | nur falls andere das Haus nutzen (Frage 6) |

---

## 7. Datenmodell (Vorschlag)

**Neue Tabelle `presence_periods`**

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | uuid | |
| `away_from` | timestamptz | Abreise / Beginn Abwesenheit |
| `arrive_at` | timestamptz, null | geplante Ankunft (null = offen) |
| `arrival_target` | text | `eco` / `comfort` |
| `room_ids` | uuid[], null | Profil – null = alle Räume |
| `source` | text | `app` / `wlan` / `alexa` |
| `note` | text | |
| `cancelled_at` | timestamptz, null | abgebrochen (z. B. unangekündigt da) |
| `created_at`, `updated_at` | timestamptz | |

RLS sofort beim Anlegen prüfen (Lehre aus den Fixes): `authenticated` voll, `pv-automation`
liest per Service-Role, der Collector braucht für Stufe 2 Insert/Update als `anon`.

**Neue Felder**

| Tabelle | Feld | Vorschlag |
|---|---|---|
| `rooms` | `away_temp` | leer = Hauswert |
| `heating_settings` | `away_temp_default` | 12 °C |
| `heating_settings` | `away_surplus_mode` | `wait_min` |
| `heating_settings` | `away_max_grid_power_w` | 1000 W |
| `heating_settings` | `preheat_fallback_hours` | 24 h |
| `heating_settings` | `preheat_max_grid_power_w` | 2000 W |
| `heating_settings` | `presence_default` | Frage 1 |
| `daily_pattern_scores` | `sig_occupancy` | `present` / `away` / `mixed` |

**Protokoll:** `system_settings.presence_state` = `{ state, since, until, arrive_at,
preheat_start, rooms: [{ room_id, target, why }], computed_at }`.

---

## 8. Wo im Code (Übersicht, noch keine Änderung)

| Teil | Datei | Änderung |
|---|---|---|
| Zustand bestimmen | `supabase/functions/pv-automation/index.ts` | direkt nach dem Laden von `heating_settings`: aktiven Eintrag in `presence_periods` suchen → `present` / `away` / `preheat` |
| Nacht | dto., Nacht-Zweig (`frost_only`) | bei Abwesenheit „Abwesend“ statt 5 °C, falls höher; in der Vorheiz-Nacht kein Frostschutz. Hinweis: Der Nacht-Zweig lädt heute alle Räume mit Thermostat – auch die mit Automatik aus. Das bei der Gelegenheit klären. |
| Tag | dto., Tagesmodus + `allocateDayTargets` | neue Modi `away` und `preheat` neben `wait` / `grid` / `battery_gate`; Phase 2 (Komfort) bei Abwesenheit aus; Phase-1-Ziel je nach `away_surplus_mode` |
| KI-Schutz | `ai-parameter-advisor`, `ai-parameter-evaluator` | neue Werte in `LOCKED_PARAMS` |
| Muster | `compute-daily-score`, `analyze-patterns` (`best_match_today`) | `sig_occupancy` setzen; Abwesenheitstage nur mit Abwesenheitstagen vergleichen |
| Analyse | `src/lib/analysisFindings.ts` | Befund „Eingespeist, während Räume unter Komfort“ an Abwesenheitstagen nicht melden |
| Batterie | `validate-battery-reserve`, `battery-soc-decision` | Abwesenheitstage ausklammern oder kennzeichnen |
| Übersicht | `src/components/overview/HouseOverview.tsx` | Zeile im Betriebsmodus: „Abwesend bis Fr 18:00 · Vorheizen ab Do 10:00“, Schnellschalter |
| Einstellungen | neue Karte `settings/PresenceSettings.tsx`, `RoomsSection.tsx` | Kalender, Hauswerte; Feld „Abwesend“ je Raum |
| Stufe 2 | `local-collector/collector-node` | FritzBox-Abfrage (TR-064) nach Handy-Anmeldung |

---

## 9. Fehlerfälle

| Fall | Verhalten |
|---|---|
| PC/Dienst in Österreich fällt während Abwesenheit aus | Thermostate halten „Abwesend“ (siehe 3.7). Neuer Hinweis, wenn der Dienst während einer Abwesenheit länger als einstellbar offline ist (später Push). |
| Ankunft verschoben oder abgesagt | Eintrag ändern/abbrechen → Vorheizen stoppt sofort, Räume zurück auf „Abwesend“ |
| Unangekündigt da | Schalter „Ich bin da“ (Stufe 1) bzw. WLAN-Erkennung (Stufe 2) |
| Vorlauf zu knapp | Räume nach Priorität; Übersicht zeigt, welcher Raum zur Ankunft noch nicht warm ist |
| Zu niedriger Wert „Abwesend“ | Untergrenze 5 °C; Hinweis in der App, dass unter ~10 °C Feuchte/Schimmel droht |

---

## 10. Stufenplan

| Stufe | Inhalt | Aufwand |
|---|---|---|
| **1** | Tabelle + Schalter + Kalender; Regeln Abwesend; Vorheizen mit festem Vorlauf; Anzeige in der Übersicht; Abwesenheitstage in Analyse/Muster kennzeichnen | mittel – eine SQL-Datei, `pv-automation`, App |
| **2** | Vorlauf aus gelernter Aufheizrate; PV-Vorladen vor Ankunft; Profile | mittel |
| **3** | WLAN-Erkennung; Alexa; Auskühlkurve lernen; KI-Hinweise | später |

Stufe 1 bringt schon fast die ganze Ersparnis.

---

## 11. Offene Fragen – Entscheidungen von Uli

1. **Standard ohne Eintrag:** Gilt „anwesend“ (wie heute) oder „abwesend“, und man trägt die
   Aufenthalte ein? Wenn du meistens weg bist, ist „abwesend“ als Standard sicherer gegen
   Verschwendung.
2. **Wert „Abwesend“:** ein Wert fürs ganze Haus oder je Raum? Startwert 12 °C in Ordnung?
3. **Überschuss bei Abwesenheit:** einspeisen (`none`), bis „Ohne PV“ (`wait_min`, Vorschlag)
   oder bis Eco?
4. **Nacht bei Abwesenheit:** 5 °C Frostschutz wie heute oder durchgehend „Abwesend“?
5. **Ankunft:** Ziel Eco oder Komfort? Wie viel Netzleistung darf das Vorheizen nehmen?
6. **Andere Nutzer:** Ist das Haus manchmal bewohnt, während du weg bist (Familie, Gäste)?
   Dann Profile/Kalender für sie mitdenken.
7. **WLAN-Erkennung** über die FritzBox in Stufe 2 gewünscht?
