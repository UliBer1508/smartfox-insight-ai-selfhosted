# Konzept: KI analysiert und schlägt vor – Uli entscheidet

**Stand:** 2. November 2026 · **Status:** ENTWURF zur Freigabe (Uli, 02.11.2026: „Die KI soll analysieren und
vorschlagen. Ich kontrolliere, ändere eventuell und genehmige.“) – noch kein Code
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

## 7. Offene Fragen an Uli

1. Grenzen in §3 so in Ordnung?
2. Sollen Untergrenze und Priorität je Raum überhaupt vorschlagsfähig sein, oder nur die Haus-Werte?
3. Sofort-Hinweise nur in der App, oder auch Push/Mail?
4. Optional: GitHub-Aktion, die nach jedem Merge die Edge Functions automatisch deployt (einmalig einen
   Supabase-Zugangsschlüssel in GitHub hinterlegen) – dann entfällt das Deployen am Österreich-PC.

## 8. Reihenfolge

1. 03.11.: PR #16 (Eco als Ziel, Raummodell) einspielen.
2. Einige Tage Tagesnoten nach neuem Maßstab und Raummodell-Nächte sammeln.
3. Nach Freigabe dieses Konzepts: Tagesanalyse + Vorschlags-Tab bauen, Evaluator auf „vorschlagen“ umstellen.
