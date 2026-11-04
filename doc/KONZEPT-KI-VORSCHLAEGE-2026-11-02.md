# Konzept: KI analysiert und schlägt vor – Uli entscheidet

**Stand:** 2. November 2026 · **Status:** FREIGEGEBEN (Uli, 02.11.2026, 22:30 – Antworten §7) · umgesetzt: Auto-Rücknahme
abgeschaltet, alle Parameter auf „suggest“ (SQL 19), Auto-Deploy (GitHub-Aktion); 04.11.: Whitelist nach §3 (SQL 20),
Tagesanalyse + KI › Zu entscheiden (SQL 21, §9)
**Baut auf:** `KONZEPT-LERNSCHLEIFE-2026-11-01.md` (Stufe 3 + 4), `KONZEPT-RAUMMODELL-2026-11-02.md`,
vorhandene Bausteine `ai-parameter-advisor`, `ai-parameter-evaluator`, `ai_parameter_whitelist`,
`ai_parameter_decisions`, `battery_soc_suggestions`, `useKiPending`

---

## 1. Grundsatz

- **Prüfmodell bleibt:** Die KI ändert keine Einstellung selbst. Sie analysiert, schlägt vor und begründet.
  Uli prüft, ändert den Wert bei Bedarf und genehmigt oder lehnt ab. Erst dann wird geschrieben.
- **Uli muss nicht suchen:** Die KI überwacht selbst. Uli bekommt einmal am Tag ein fertiges Paket
  („Was ist gestern passiert, was schlage ich vor, warum“) und bei echten Problemen sofort einen Hinweis.
- **Feste Regeln bleiben fest:** Untergrenze, Nachtregel, „Steuerung nur über die Thermostate“, gesperrte Parameter
  (`LOCKED_PARAMS`). Die KI darf dazu Beobachtungen melden, aber keine Änderung vorschlagen, die sie aufhebt.
- **Maßstab ist die Tagesnote** nach Ulis Zielen (Eco halten, PV nicht verschenken, Netz nicht zur falschen Zeit).

## 2. Was die KI selbst überwacht (täglich 10:00, nach Tagesnote und Raummodell)

| Prüfung | Woraus | Mögliche Feststellung |
|---|---|---|
| **Vorhersage gegen Messung** | `raum_vorausschau` (gestern) gegen gemessene Morgentemperatur | „Bad kühlt schneller aus als gedacht (vorhergesagt 21,4, gemessen 20,6)“ |
| **Eco erreicht?** | Raum-Minuten unter Eco je Raum, Tagesart | „An 3 schlechten Tagen kam Flur nie auf Eco – Heizleistung ohne PV reicht nicht“ |
| **PV verschenkt?** | Einspeisung, während Räume unter Komfort lagen | „Gestern 4 kWh eingespeist, 5 Räume unter Komfort – Schwelle Sonnentag/Ein-Schwelle zu hoch“ |
| **Netz zur falschen Zeit?** | `netz_bei_einspeisung_kwh` | „Morgens aus dem Netz geheizt, mittags eingespeist – an solchen Tagen früher warten“ |
| **Tagesart richtig?** | Tagesart morgens gegen tatsächliche PV | „3× Sonnentag angenommen, Überschuss kam nicht – Schwelle anheben“ |
| **Nacht** | Raum-Minuten nachts unter Untergrenze, Batterie morgens | „Zimmer Uli nachts 2 h unter Untergrenze bei −6 °C“ |
| **Technik** | Thermostat offline, Raum ohne Messwerte, Raummodell ohne gültige Nächte | „Haustür seit 6 h ohne Messwert“ |

Grundlage sind ähnliche Tage (Mustergedächtnis: Prognose, Außentemperatur, Batterie) mit ihrer Tagesnote –
Stufe 3 der Lernschleife.

## 3. Was daraus wird: Vorschläge

Jeder Vorschlag enthält:
1. **Was:** Parameter, alter Wert → vorgeschlagener Wert (innerhalb der Grenzen aus der Whitelist)
2. **Warum:** die Feststellung aus §2 mit Zahlen und den Tagen, auf die sie sich stützt
3. **Erwartete Wirkung:** z. B. „Flur erreicht Eco ca. 2 h früher, ca. +1,5 kWh Netz an trüben Tagen“
4. **Vergleich:** bestbewerteter ähnlicher Tag und welche Einstellung dort galt
5. **Sicherheit:** wie viele Tage dahinterstehen (unter 3 Tagen nur „Beobachtung“, kein Vorschlag)

Vorschlagsfähig (Kandidaten, Grenzen in `ai_parameter_whitelist`):

| Parameter | Grenzen (Entwurf) |
|---|---|
| `max_grid_heating_power_w` – Heizleistung ohne PV | 1000–6000 W |
| Schwelle Sonnentag (Tagesart) – neu einstellbar machen | 0,5–1,5 |
| `heating_min_battery_soc` – Batterie-Grenze (bisher eigener Batterie-Vorschlag) | 40–90 % |
| `wait_min_temp` je Raum – Untergrenze | Eco − 2 … Eco |
| `priority` je Raum | 1–12 |
| `pv_boost_max_temp` je Raum – Estrich laden bis | Komfort … Komfort + 2 |

Nicht vorschlagsfähig: Nachtzeiten, Ein-/Aus-Schwelle Überschuss (gesperrt), Eco/Komfort (Ulis Wunschwerte).
Eco und Komfort darf die KI nur kommentieren („Komfort 23 wird an Sonnentagen nie erreicht“).

## 4. Ablauf für Uli

1. **Täglich ~10:00:** Tab **KI › Vorschläge** zeigt das Tagespaket: kurzer Rückblick (Note, was gut/schlecht lief),
   0–3 Vorschläge. Gibt es nichts, steht dort „Alles im Rahmen“ – keine Nachricht.
2. Je Vorschlag: **Genehmigen** · **Wert ändern und genehmigen** · **Ablehnen** (optional mit Grund).
   Abgelehnte Vorschläge mit gleichem Inhalt kommen frühestens nach 7 Tagen und nur mit neuen Belegen wieder.
3. Nach dem Genehmigen schreibt das System den Wert, protokolliert ihn (Protokoll › Ereignisse, mit Begründung)
   und **beobachtet die Wirkung** 3 Tage lang (`ai-parameter-evaluator`).
4. **Nach 3 Tagen:** Bericht im Tab KI: „Wirkung wie erwartet / nicht erkennbar / schlechter“. Bei „schlechter“
   kommt automatisch ein **Rücknahme-Vorschlag** – den genehmigt ebenfalls Uli.

## 5. Hinweise sofort (ohne auf 10:00 zu warten)

Nur bei Dingen, die nicht bis morgen warten können:
- Raum seit > 1 h unter Untergrenze
- Thermostat > 2 h offline oder Dienst am Österreich-PC ohne Sync
- Batterie leer und Netzbezug für Heizung > Grenze (Hinweis auf möglichen Fehler)

Kanal: Hinweis-Leiste in der App; optional Push/Mail (später entscheiden).

## 6. Was dafür gebaut werden muss

| Teil | Inhalt | vorhanden? |
|---|---|---|
| Tägliche Analyse | Funktion „Tagesanalyse“ (Prüfungen §2, ähnliche Tage, Vorschläge §3) | teilweise (`ai-parameter-advisor`, Batterie-Vorschlag) |
| Vorschlags-Tabelle | ein gemeinsamer Ort für alle Vorschläge inkl. Batterie (Status offen/genehmigt/geändert/abgelehnt, Begründung, Belege, erwartete Wirkung) | `ai_parameter_decisions` + `battery_soc_suggestions` → zusammenführen |
| Whitelist | Grenzen aus §3, Stufe „suggest“ für alle; „auto“ wird nicht verwendet | vorhanden, Werte anpassen |
| Wirkungskontrolle | 3 Tage nach Genehmigung Tagesnoten vorher/nachher ähnlicher Tage vergleichen | `ai-parameter-evaluator` – **automatische Rücknahme abschalten**, stattdessen Rücknahme-Vorschlag |
| App | Tab KI › Vorschläge: Tagespaket, Genehmigen/Ändern/Ablehnen, Wirkungsberichte | teilweise (`useKiPending`) |
| Sofort-Hinweise | Prüfung im 5-Minuten-Takt (SQL-Cron, ohne HTTP) | `api_errors`-Banner vorhanden |

**Wichtig:** `ai-parameter-evaluator` setzt heute bei schlechtem Ergebnis selbst zurück (AUTO-ROLLBACK). Das
widerspricht dem Prüfmodell und wird auf „Rücknahme vorschlagen“ umgestellt.

## 7. Entscheidungen (Uli, 02.11.2026)

1. **Grenzen** wie in §3 – passen so.
2. **Haus- und Raumwerte** sind vorschlagsfähig (Untergrenze, Priorität, Estrich laden bis je Raum).
3. **Sofort-Hinweise nur in der App** (Hinweis-Leiste), keine Mail/Push.
4. **Auto-Deploy einrichten:** `.github/workflows/deploy-functions.yml` deployt nach jedem Merge auf `main` die
   geänderten Edge Functions. Einmalig: Secret `SUPABASE_ACCESS_TOKEN` in GitHub hinterlegen. SQL bleibt manuell.

## 8. Reihenfolge

1. ✅ 02.11.: PR #16 (Eco als Ziel, Raummodell) eingespielt; Auto-Rücknahme abgeschaltet, SQL 19, Auto-Deploy.
2. Einige Tage Tagesnoten nach neuem Maßstab und Raummodell-Nächte sammeln.
3. ✅ 04.11.: Whitelist nach §3 (SQL 20), Tagesanalyse + KI › Zu entscheiden gebaut (SQL 21, §9).

## 9. Umsetzung „KI › Zu entscheiden“ (04.11.2026)

**Anlass (Uli, 04.11.):** „Mir geht es darum, alle zu entscheidenden Punkte an einem Platz zu sehen.“ Im Tab KI stand
„Zu entscheiden (0)“, obwohl die KI stündlich Vorschläge machte – alle Parameter standen in der Whitelist noch auf
„shadow“ (SQL 19 hatte nur „auto“ umgestellt), und die Liste zeigt nur „suggest“. Inhaltlich passten die Vorschläge nicht
zu den Regeln (Komfort je Raum nach der momentanen Temperatur, Nacht auf Frostschutz, Batterie-Grenze 90 → 85 → 80 → 85
innerhalb eines halben Tages).

**Uli zum Mockup (04.11.):** „Es sollte einfach sein, erklären, um was es geht.“ → „passt“.

### 9.1 Whitelist (SQL 20)
Vorschlagsfähig nur noch: `wait_min_temp` (Untergrenze je Raum, 16–24 °C, inhaltlich Eco − 2 … Eco),
`pv_boost_max_temp` (Estrich laden bis, 19–26 °C, inhaltlich Komfort … Komfort + 2), `max_grid_heating_power_w`
(1000–6000 W) und – nur über die Batterie-Empfehlung – `heating_min_battery_soc` (40–90 %). Alle anderen Einträge
`enabled = false`. Noch nicht drin: Priorität (Tausch-Logik nötig, `rooms.priority` ist eindeutig), Schwelle Sonnentag
(noch kein Einstellwert).

### 9.2 Ein Platz, einfache Worte
Tab **KI › 1 Zu entscheiden** (`src/components/ki/ZuEntscheiden.tsx`):
1. **Rückblick auf gestern** in einem Absatz (Tagesart, Nacht, Räume unter Eco, verschenkte Sonne, Tagesnote).
2. **Vorschläge als Frage**, je mit „Was sich ändert“, „Warum“, „Was es bringt – und kostet“; Knöpfe
   **Ja, übernehmen · Anderen Wert · Nein**. Die Batterie-Empfehlung erscheint im selben Format.
3. **Rückblick 3 Tage nach einer Genehmigung:** Tagesnote 3 Tage vorher/nachher; ≥ 5 Punkte schlechter →
   Rücknahme-Frage („Ja, zurück auf … / Nein, so lassen“), sonst ein Satz unter „Zur Info“.
4. **Zur Info – nichts zu tun:** z. B. „Batterie: um 21:00 neu gerechnet – 85 % passt.“, Beobachtungen mit zu wenigen Tagen.

Übersicht und Kopfzeile zählen nur noch offene Vorschläge, Rücknahmen, Batterie und Preise. Die alte Liste
„Parameter-Vorschläge & Protokoll“ steht eingeklappt unter KI › 3 als Protokoll.

### 9.3 Tagesanalyse (`ki-tagesanalyse`, täglich 10:00 über `analysis-scheduler`)
Grundlage: letzte 7 Tage, je Raum aus `ki_raum_tag()` (Minuten unter Eco − 0,3 °C im Tagesfenster, Morgentemperatur
in der Stunde davor, wärmste Temperatur, Heizminuten) und die Tagesnote (`tages_bewertung`). Tagesart: Einspeisung
≥ 2 kWh = Sonnentag, < 1 kWh = trüb.

| Regel | Bedingung (an ≥ 3 der 7 Tage) | Vorschlag |
|---|---|---|
| Untergrenze je Raum | Untergrenze morgens gehalten (± 0,3 °C bis + 0,5 °C) und danach > 2 h unter Eco | Untergrenze + 0,5 °C (höchstens Eco) |
| Heizleistung ohne Sonne | trüber Tag, ≥ 3 Räume > 2 h unter Eco | + 500 W (höchstens 6000 W) |
| Estrich laden bis je Raum | Sonnentag, Raum hat seine Grenze erreicht (−0,2 °C), trotzdem ≥ 2 kWh eingespeist | + 0,5 °C (höchstens Komfort + 2) |

Höchstens 3 Vorschläge am Tag (Rücknahmen zuerst, dann Hauswerte, dann Raumwerte). Gezählt werden nur Tage nach der
letzten genehmigten Änderung desselben Werts (bei der Untergrenze auch nach einer Änderung der Heizleistung ohne Sonne). Kein neuer Vorschlag, solange der gleiche (Parameter + Raum) offen
ist oder in den letzten 7 Tagen abgelehnt wurde. Weniger als 3 Tage → nur eine Beobachtung unter „Zur Info“.
Die Texte schreibt die Funktion aus festen Satzbausteinen mit den gemessenen Zahlen – nachprüfbar, keine erfundenen Werte.
Die stündlichen Gemini-Vorschläge (`ai-parameter-advisor-15min`) sind abgeschaltet; die Batterie-Empfehlung 21:00 bleibt.

### 9.4 Schreiben
Genehmigen schreibt über die bestehenden Wege: Raum-/Hauswerte über `aiParameters.ts` (prüft vorher, ob der Wert in der
Datenbank noch dem angezeigten alten Wert entspricht), die Batterie-Grenze nur über `battery-soc-decision` (jetzt auch
mit eigenem Wert und für Rücknahmen). Jede Entscheidung steht in `ki_vorschlaege` (Status, Wert, Wirkung) und – für
Raum-/Hauswerte – zusätzlich in `ai_parameter_decisions`; die Änderung selbst protokolliert der Einstellungs-Trigger
unter Protokoll › Ereignisse.

### 9.5 Erster Lauf und Korrektur (04.11.2026)
Der erste Lauf schlug für Toilette Eingang, Zimmer Luca und Zimmer Uli eine höhere Untergrenze vor. Die Räume lagen
morgens aber schon **unter** ihrer Untergrenze – die Ursachen waren andere: Nacht 02./03.11. auf Frostschutz 5 °C
(seit 03.11. abends „Nachtwert halten“ ab 20:00) und tagsüber die Grenze **2000 W** ohne Sonne („Grenze 2000W erreicht →
wartet“; Bad Uli + Zimmer Uli brauchten 1800 W, das Wohnzimmer mit 2400 W passte nie hinein). Uli: Toilette Eingang
20,0 °C genehmigt, Luca/Uli abgelehnt, **Heizleistung ohne Sonne 2000 → 4000 W** genehmigt.
Korrektur der Regeln: Untergrenze nur vorschlagen, wenn sie morgens gehalten wurde – sonst ein Hinweis „Nicht einmal die
Untergrenze gehalten … Ursache prüfen“; greift die Hausgrenze (Regel 2), keine Untergrenzen-Vorschläge; Hauswerte vor
Raumwerten; Tagesart auch aus der PV-Menge (≥ 25 kWh = Sonnentag, < 15 kWh und < 1 kWh Einspeisung = trüb), weil das
Haus an Sonnentagen fast alles selbst nahm. Ein zweiter Lauf schlug noch den Flur vor (Tage mit 2000 W) – zurückgezogen,
seitdem zählt die Untergrenze erst Tage nach einer Änderung der Heizleistung ohne Sonne. Deployt per Supabase-Connector
(ki-tagesanalyse v3).
