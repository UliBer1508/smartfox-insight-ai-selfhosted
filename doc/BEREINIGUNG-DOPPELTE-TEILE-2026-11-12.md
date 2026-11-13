# Bereinigung doppelter Entwicklungen (12.11.2026)

**Anlass (Uli, 12.11.2026):** „Warum wurden Logiken 2 mal entwickelt und warum haben die besseren neueren Lösungen die
alten nicht ersetzt?“ – „Ich möchte, dass wir die doppelt entwickelten Teile durch die neuere bessere Variante ersetzen.“
– „Du solltest als erstes die doppelten Entwicklungen bereinigen.“

**Stand:** Stufe 1 umgesetzt (PR, SQL 34 nach Freigabe). Stufe 2 vorbereitet, Entscheidung Uli je Punkt.
**13.11.2026:** Modus „steuern“ gebaut, Mustergedächtnis (`analyze-patterns`) und alle Sprach-KI entfernt
(`doc/FIX-PLANER-MODELL-2026-11-13.md`). Damit erledigt: Nr. 8 und 11; Nr. 6, 7, 9 wirken im Modus „steuern“ nur noch im Rückfall.

---

## 1. Warum es doppelte Teile gibt

1. **Ablösung ohne letzten Schritt.** Der Heizplaner (06.11., `KONZEPT-PLANER-2026-11-06.md`) war in drei Stufen geplant:
   Schatten → beobachten → steuern. Stufe 1 läuft, Stufe 2 wurde nie abgeschlossen, Stufe 3 („steuern“) ist nicht gebaut.
2. **Weitergebaut am Regelwerk.** Seit 06.11. gingen fast alle Korrekturen in `pv-automation` (Vorrang, Schaltband,
   Fühler in der Sonne, DP 19, Leistungsgrenze, Wechselwirkungen) – genau das, was der Planer ersetzen sollte.
   Claude hat das nicht angesprochen.
3. **Neu daneben statt anstelle.** Neue Bausteine (Heizmodell, PV-Modell des Planers) wurden gebaut, ohne die alten
   abzuschalten oder die Steuerung umzustellen. Kein PR enthielt den Schritt „alt raus“.

**Arbeitsregel ab 12.11.2026:**
- Jedes neue Teil, das ein vorhandenes ersetzt, entfernt das alte **im selben PR** (oder der PR nennt ausdrücklich, wann).
- Jede Änderung an `pv-automation` nennt, ob sie Teil des Regelwerks ist, das der Planer ablösen soll.
- Vor jedem neuen Baustein: prüfen, ob es ihn schon gibt (diese Liste).

## 2. Alle doppelten Teile

| # | Aufgabe | alt | neu (bleibt) | wirkt das alte heute? | Stufe |
|---|---|---|---|---|---|
| 1 | Tagesplan | KI-Tagesplaner `ai-daily-planner` (Claude/Gemini, 05:30) → `ai_daily_plans` | Heizplaner `heizplaner` (alle 15 min) | **nein** – `pv-automation` las `heating_recommendations` (leer), Rang hätte nur bei gleicher Priorität gewirkt | **1 ✓** |
| 2 | Lernen je Raum | Policies `learned_policies` (`update-learned-policies`, 19:30) | Heizplaner | **nein** im Lokal-Modus – Budget-Override und Tagesmodus überschreiben immer (K4) | **1 ✓** |
| 3 | Auskühlen je Raum | Nacht-Modell `raum_abkuehlung`/`raum_modell` (SQL 18, 1–7 Nächte je Raum) | Heizmodell `heizmodell` (k, g, s, c aus 30 Tagen) | **nein** – nur Sortierung bei gleicher Priorität; `rooms.priority` ist eindeutig (Index `rooms_priority_unique`) | **1 ✓** |
| 4 | Sonne im Raum | `monitor-solar-heating` (alle 15 min → `solar_heating_events`), `analyze-solar-gain` (20:00 → `rooms.calculated_solar_gain_factor`) | Heizmodell (s) + „Fühler in der Sonne“ (09.11.) | **nein** – `solar_heating_events` liest niemand; Faktor nur in KI-Prompt-Text und Raumkarte | **1 ✓** |
| 5 | Raumleistung | `calculate-heating-power` (`calculated_power_w`) | `measure-room-power` (`heating_power_w`, gemessen) | **nein** – kein Aufruf, kein Zeitplan, Feld überall leer | **1 ✓** |
| 6 | PV-Prognose | Forecast.Solar (`fetch-pv-forecast`) × Genauigkeitsfaktor in `pv-automation` | PV-Modell des Planers (`planer_pv_modell`, Strahlung je Stunde, Bergschatten, Nachführung) | **ja** – Tagesart, Budget, Boost | 2 |
| 7 | Energiebedarf je Raum | `room_ml_features.energy_per_degree_wh` (`ml-feature-extraction`, 18:00) | Heizmodell (Leistung / g) | **ja** – Eco-Bedarf in der Tagesart | 2 |
| 8 | „Mustergedächtnis“ | `analyze-patterns` (Gemini: match_today 05:30, Woche, Monat) + `compute-daily-score` (`daily_pattern_scores`) → `best_match_today`, `weekly_insight`, `preheating_signal` | Planer + Gegenrechnung (`heizplan_vergleich`) + Tagesnote (`tages_bewertung`) | **ja** – Schwelle Tagesart ±0,3, Eco-Budget min 600 W, Komfort +400 W, Komfort −30 % | 2 |
| 9 | Batterie / Tagesart | feste Regeln in `pv-automation` (Sonnentag, Batterie-Schutz 65 %, Wartetag) + Batterie-Vorschlag 21:00 | Planer rechnet Batterie über 24 h | **ja** | Modus „steuern“ |
| 10 | Bewertung | `learning_events` + `evaluate-decision` (Reward je Entscheidung) | `tages_bewertung` + `heizplan_vergleich` | nur Anzeige (KI › Lernen) | 2 |
| 11 | KI-Entscheidung je Raum (Cloud) | `analyze-patterns` optimize_decision (nur mit Tuya-Cloud-Schlüsseln) | Planer | **nein** im Lokal-Modus; Cloud-Funktionen bleiben erhalten (Uli 26.10.) | später |

## 3. Stufe 1 – umgesetzt (keine Wirkung auf die Steuerung)

**Code (PR `bereinigung-doppelte-teile`):**
- `pv-automation`: Laden des KI-Tagesplans und der gelernten Policies entfernt; die Vorausschau rechnet mit dem
  Heizmodell statt mit dem Nacht-Modell (mit innerer Wärme c: T∞ = T_außen + c/k). Sortierung kommentiert
  (Priorität eindeutig). Cloud-Zweig (LLM-Entscheidung) unverändert.
- Functions gelöscht: `ai-daily-planner`, `update-learned-policies`, `monitor-solar-heating`, `analyze-solar-gain`,
  `calculate-heating-power` (+ Einträge in `supabase/config.toml`). Die GitHub-Aktion überspringt gelöschte Ordner;
  die bereits deployten Functions bleiben im Dashboard, laufen aber ohne Zeitplan nicht mehr (dort löschbar).
- App: KI › „KI-Tagesplan“ und „ML-Folgerate“ entfernt (Planer in Abschnitt 2 ersetzt beides); Einstellungen › Räume:
  Knopf „Solar-Analyse“ und die alten Schätzwerte entfernt, Anzeige „Heizleistung gemessen“ + Verweis aufs Heizmodell;
  Protokoll › Raummodell zeigt das Heizmodell (Auskühlen in 10 h, Aufheizen, Fehler 12 h gegen „bleibt gleich“,
  abends nötig, morgen ohne Heizen). `getEffectiveHeatingPower`: gemessene Leistung zuerst (wie L2).

**SQL 34 (nach Freigabe):** Zeitpläne `ai-daily-planner-06am`, `update-learned-policies-daily`, `solar-heating-monitor`,
`daily-solar-analysis` entfernt; `nacht_protokoll_tick` ohne `raum_abkuehlung_nacht`. Keine Tabelle, keine Daten gelöscht.

**Wechselwirkungen geprüft:**

| Teil | wer las es | Folge des Entfernens |
|---|---|---|
| `ai_daily_plans` | nur die entfernte Karte | keine |
| `heating_recommendations` (daily_planner) | `pv-automation` (leer) | keine |
| `learned_policies` | `pv-automation` Raumschleife | Lokal: keine (überschrieben). Cloud: Policy-Stufe entfällt, LLM-Zweig bleibt |
| `raum_modell`/`raum_abkuehlung` | `pv-automation` Vorausschau, Protokoll | Vorausschau aus Heizmodell; Sortierung unverändert (Priorität eindeutig) |
| `raum_vorausschau` | Protokoll | gleiche Felder + `c`, `prior`, `quelle` |
| `solar_heating_events` | niemand | keine |
| `rooms.calculated_solar_gain_factor` | `monitor-solar-heating` (entfernt), Raumkarte (entfernt) | keine; `has_solar_gain` bleibt als Einstellung |
| `calculated_power_w` | Fallback in Code/App | leer → keine |
| Tagesnote, Tagesanalyse, Planer | lesen keines der entfernten Teile | keine |

Geprüft: `deno check pv-automation` – keine neue Fehlerart (die bekannte Meldung `quotaData: never` erscheint an
zwei Stellen mehr); App `tsc` unverändert 5 Altfehler, keiner in den geänderten Dateien; `vite build` ok.

## 4. Stufe 2 – Teile mit Wirkung (Entscheidung Uli)

Diese Teile verändern das Heizen. Ersetzen nur nach Nachrechnung mit echten Daten und Freigabe.

### 4.1 PV-Prognose (Nr. 6)
- Befund: Forecast.Solar lag in 14 Tagen im Mittel **10,5 kWh/Tag** daneben, fast immer zu niedrig (Ø 15,6 statt 22,8 kWh).
  11.11.: Forecast.Solar 6 kWh, gemessen 19,7 kWh, Planer um 6 Uhr **20,5 kWh**.
- Folge am 11.11.: Die Steuerung hielt den Tag fast durchgehend für einen **„schlechten Tag“** (nur 09:50–09:58 „Sonnentag“),
  obwohl die Sonne kam.
- Ersetzen: `pv-automation` liest die PV je 15 min aus dem jüngsten `heizplan` (≤ 30 min alt), Genauigkeitsfaktor = 1
  (der Planer führt selbst nach); Forecast.Solar nur noch als Rückfall.
- Nachrechnen vorher: Tagesart und Budget der letzten Tage mit beiden Prognosen.

### 4.2 Energiebedarf je Raum (Nr. 7)
- Beide Quellen haben Ausreißer: alt Wohnzimmer 58 kWh/°C, neu Wirtschaftsraum 49 kWh/°C (Aufheizen 0,04 °C/h).
- Ersetzen erst, wenn das Heizmodell für alle Räume plausibel ist; sonst verschiebt sich die Tagesart.

### 4.3 Mustergedächtnis (Nr. 8)
- Wirkt heute auf das Budget: 11.11. 42× „Winner-Tag 28.10. → Eco-Budget min 600 W“, Schwelle Tagesart −0,15.
- Der Wochen-Hinweis vom 08.11. nennt eine **Eigenverbrauchsquote von 3,4 %** (gemessen: 8 kWh Einspeisung bei 319 kWh PV
  in 14 Tagen, also ~97 %). Mit diesem Wert drosselt die Steuerung das Komfort-Budget um 30 %, sobald eines vergeben
  wird – am 11.11. einmal (131 → 92 W). Gilt bis zum nächsten Wochenlauf (TTL 7 Tage).
- Ersetzen: mit dem Modus „steuern“ entfällt die Schicht; bis dahin Vorschlag: diese drei Zuschläge abschalten.
- **Umgesetzt 12.11.2026 (Stufe 2a, Uli: „ausführen“):** in `pv-automation` entfernt – Tagesart-Schwelle aus `best_match_today`
  (jetzt fest 1,0), `preheating_signal` (inkl. Pre-Heat-Override je Raum), `weekly_insight` (Vorheizen und Komfort ×0,7),
  Pattern-Recall-Bonus. Einstellungen › KI: Regler „Stärke“ entfernt (wirkte nur auf diese Zuschläge).
  `analyze-patterns` schreibt die Werte weiter (Hinweis für `ai-parameter-advisor`); Abschalten mit Stufe 2c.
  Zur Wirkung: Am 12.11. lag die Tagesart-Ratio den ganzen Morgen bei 0,00 – die Schwelle (0,91 statt 1,0) war ohne Einfluss.

### Zeitplan Stufe 2 (festgelegt 12.11.2026)

| | Was | Wann | Bedingung |
|---|---|---|---|
| 2a | Mustergedächtnis-Zuschläge (§4.3) | 12.11.2026 | erledigt |
| 2b | PV-Prognose tauschen (§4.1) | Nachrechnung 16.11.2026, Umbau danach | Nachrechnung zeigt: Planer-Prognose näher an der Messung |
| 2c | Bewertung (§4.4), Status-Karten (§4.6), alte Tabellen und `analyze-patterns` | mit Modus „steuern“ | Planer steuert – `analyze-patterns` entfernt 13.11.2026, Rest offen |
| 2d | Energiebedarf je Raum (§4.2) | Prüfung 23.11.2026 | Heizmodell für alle Räume plausibel (Fehler 12 h besser als „bleibt gleich“) |

### 4.4 Bewertung (Nr. 10)
- `learning_events`/`evaluate-decision` bewerten Einzelentscheidungen für die (entfernten) Policies. Die Tagesnote und die
  Gegenrechnung messen an Ulis Zielen. Ersetzen: KI › Lernen auf Tagesnote/Gegenrechnung umstellen, dann
  `evaluate-decision` abschalten.

### 4.5 Batterie und Tagesart (Nr. 9)
Gehört zum Modus „steuern“ (Mockup zuerst, Uli 12.11.). K5 erledigt sich damit.

### 4.6 Status-Karten im KI-Tab (entschieden 12.11.2026: mit Stufe 2 entfernen)

`AutomationStatusCard` und `AIStatusWidget` zeigen den Zustand der alten Regel- und Lernteile (Policies, Lernereignisse).
Sie werden zusammen mit 4.3/4.4 entfernt; der Status der heutigen Steuerung steht in Auto-Steuerung › Steuerung und im Systemstatus der Kopfleiste.

## 5. Einspielen Stufe 1

1. PR mergen → `pv-automation` wird per GitHub-Aktion deployt, App per Vercel.
2. SQL `34_bereinigung_doppelte_teile.sql` ausführen (nach Freigabe). Prüfabfrage am Ende: keine Zeile.
3. Prüfen: Log `[VORAUSSCHAU] … (k …, c …)` beim nächsten Tageslauf; Protokoll › Raummodell zeigt das Heizmodell.
4. Optional: im Supabase-Dashboard die fünf gelöschten Functions entfernen.
