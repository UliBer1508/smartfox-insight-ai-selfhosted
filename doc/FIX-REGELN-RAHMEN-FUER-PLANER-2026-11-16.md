# FIX: Feste Regeln sind der Rahmen der KI (16.11.2026)

## Anlass
16.11.2026, 06:17: Zimmer Luca lag mit 21,2 °C über Min (21 °C). Es gab keinen PV-Strom, die Batterie stand bei 4 %, und
die PV-Prognose für den Tag lag bei 25 kWh. Trotzdem setzte die Steuerung im Modus „steuern“ den Sollwert auf 22,5 °C
und heizte zwei Stunden aus dem Netz vor (Plan: bis 22,6 °C, danach den ganzen Tag ohne PV-Heizen).

Uli: „Die PV-Auslastung ist Ziel. Wenn PV-Strom kommt – Vorhersage – soll auf den gewartet werden. Das war immer
vorgesehen.“

## Ursache
- Die Regel-Steuerung (pv-automation) kennt den Tagesmodus „wait“: An Sonnentagen hält sie Min und wartet auf die Sonne.
- Im Modus „steuern“ (seit 13.11.2026) ersetzte der Plan diese Regel ganz. Der Planer kannte keine Regel, nur eine
  Kostenrechnung: 1 °C·h unter Normal ≈ 0,6 kWh × Prioritätsfaktor (Luca ≈ 1 kWh) gegen 1 kWh Netzstrom.
  Normal (22 °C) gilt ab 08:00, der Estrich ist träge → die Lücke am Vormittag „kostete“ mehr als 1–2 kWh Netz um 6 Uhr.
  Bei festem Tarif ist Netzstrom um 6 Uhr für die Rechnung genauso teuer wie um 10 Uhr → früh heizen gewinnt.
- Entwurfsfehler (Claude, 06./13.11.): Die feste Regel wurde durch eine Gewichtung ersetzt, ohne nachzurechnen, ob die
  Gewichtung das Warten wirklich erzwingt. Das widersprach Ulis Regel 12.11. (keine doppelte Logik nebeneinander).

## Wie es jetzt aufgebaut ist (Uli, 16.11.2026: „passt“)
| Ulis Begriff | Modus in der App | Was entscheidet |
|---|---|---|
| **Planer (Regeln)** | `aus` | nur die festen Regeln (pv-automation) |
| **KI rechnet mit** | `schatten` | Regeln steuern, die KI rechnet alle 15 min mit und wird gegengerechnet |
| **KI steuert** | `steuern` | die KI entscheidet **innerhalb der Regeln**, wann und welcher Raum heizt |

- Zurück auf „Planer (Regeln)“ → die Regeln übernehmen sofort.
- Hält die KI eine Regel für falsch, übergeht sie sie nicht, sondern es entsteht ein Vorschlag mit Belegen
  (Gegenrechnung) unter **KI › Zu entscheiden**. Übernommen wird erst mit Ulis Zustimmung.
- Die Modus-Namen in der App sind entsprechend umbenannt (AutoSteuerung.tsx, PlanerView.tsx). Die Werte in der
  Datenbank (`aus`/`schatten`/`steuern`) bleiben gleich.

## Die festen Regeln an einer Stelle: `supabase/functions/_shared/heizregeln.ts`
Steuerung und Planer benutzen dieselben Funktionen:
- `tagesart()` – Sonnentag, wenn Rest-PV − Batterie-Laden ≥ Bedarf für Normal (Schwelle 1,0, wie seit 12.11.).
- `netzGrenze()` – ohne PV-Überschuss darf aus Netz/Batterie geheizt werden: Nacht, Abend (nach Sonnenuntergang),
  Sonnentag und abwesend → **nur bis Min**; Tag ohne genug Sonne → **bis Normal**.
- `netzHeizenErlaubt()` – unter Min + Vorlauf immer (Min hat Vorrang), sonst nach der Netzgrenze.

## Änderungen
1. **Planer (heizplaner/modell.ts, rechnen.ts):** Jeder halbstündige Heizblock wird gegen die Regel geprüft. Ist er nicht
   zu mindestens der Hälfte mit PV-Überschuss gedeckt, ist er nur erlaubt, wenn `netzHeizenErlaubt` gilt. Am Sonnentag
   lädt die Sonne zuerst die Batterie bis `heating_min_battery_soc`. Tagesart je Kalendertag aus der eigenen
   PV-Vorhersage und dem gelernten Raummodell (Folgetag: Batterie am Morgen mit 20 % angenommen). Der Plan speichert den
   Rahmen (`plan.regeln`: Tagesart, Netzgrenze je Slot `m`/`n`).
2. **Steuerung (pv-automation):** `planerImRahmen()` prüft jede Heizentscheidung des Plans (Tag und Nacht). Ohne freien
   PV-Überschuss und außerhalb der Regel bleibt das Thermostat aus; die Begründung steht in der Raumkarte
   („Regel: ohne PV-Überschuss nur bis Min … → wartet auf PV“). Die Tagesart kommt jetzt aus `_shared/heizregeln.ts`
   (gleiche Rechnung wie vorher).
3. **SQL 45:** `heizplaner_daten` liefert zusätzlich `heating_min_battery_soc`, Koordinaten und den Sonnenuntergang aus
   `pv_forecasts` (sonst astronomisch berechnet).
4. **App:** Modus-Namen umbenannt.

## Nachrechnung mit echten Daten (Gegenrechnung 09.–15.11.2026, echte PV, Start um Mitternacht)
| Tag | Tagesart | Netz alt | Netz neu | unter Min (°C·h) alt / neu | Netz über Min 06–08 Uhr alt → neu |
|---|---|---|---|---|---|
| 09.11. | kein Sonnentag | 55,2 | 54,4 | 27,5 / 27,5 | – |
| 10.11. | kein Sonnentag | 56,9 | 56,2 | 50,3 / 50,3 | Bad Uli 0,5 h → – |
| 11.11. | kein Sonnentag | 53,3 | 53,3 | 34,3 / 34,3 | – |
| 12.11. | kein Sonnentag | 52,5 | 52,5 | 49,2 / 49,2 | – |
| 13.11. | kein Sonnentag | 58,6 | 58,2 | 36,6 / 36,6 | – |
| 14.11. | kein Sonnentag (Ratio 0,7) | 32,2 | 32,2 | 24,7 / 24,7 | – |
| 15.11. | **Sonnentag** (Ratio 1,5) | 10,1 | **8,2** | 1,8 / 1,8 | Bad Uli 0,25 h + Luis 1 h → Bad Uli 0,25 h |

- Am Sonnentag 1,9 kWh weniger Netz, kein Raum öfter unter Min, etwas mehr Zeit knapp unter Normal (4,9 statt 3,6 °C·h)
  – das ist das gewollte Warten auf die Sonne.
- An Tagen ohne Sonne bleibt alles praktisch gleich (Regel erlaubt dort Normal aus dem Netz).
- Rest am 15.11. (Bad Uli 0,25 h): Der Block wird am Blockanfang geprüft; liegt der Raum knapp unter Min + Vorlauf,
  darf er eine halbe Stunde heizen. Die Steuerung prüft zusätzlich alle 5 min und schaltet ab, sobald Min + Vorlauf
  erreicht ist.

## Aufgefallen, nicht Teil dieses Fixes (Vorschlag für später)
An Tagen ohne Sonne heizt die KI in der Gegenrechnung deutlich mehr als die Regeln (≈ 53–58 statt 21–40 kWh Netz), hat
am Tagesende aber auch mehr Wärme im Estrich (bereinigt etwa gleich). Ob das sinnvoll ist, soll die Lernschleife
(KI › Zu entscheiden) mit Belegen vorschlagen – nicht still geändert werden.

## Nebenwirkungen geprüft (Regel 08.11.2026)
- **Wer liest/schreibt dieselben Daten:** `heizplan` (heizplaner schreibt, pv-automation liest) – neues Feld
  `plan.regeln`, alte Felder unverändert. `heating_day_mode` unverändert.
- **Deploy:** Änderung in `_shared/` → der GitHub-Workflow deployt **alle** Edge Functions aus `main` (siehe
  `.github/workflows/deploy-functions.yml`). Wer eine Funktion zuletzt von Hand deployt hat, bekommt den Stand aus `main`.
- **Verhalten über Zeit:** Plan alle 15 min, Steuerung alle 5 min. Wechselt die Tagesart im Laufe des Tages (Prognose
  ändert sich), ändern sich beide beim nächsten Lauf gleich, weil sie dieselbe Funktion benutzen (Eingangswerte:
  Steuerung grobe Schätzung, Planer Raummodell – kann am Rand abweichen; dann gilt die strengere Prüfung der Steuerung).
- **Rückfall:** Ohne SQL 45 rechnet der Planer mit 75 % Batterie-Schwelle und astronomischem Sonnenuntergang.

## Einspielen
1. SQL `supabase/SQL/45_planer_regeln_rahmen.sql` ausführen.
2. PR mergen → Vercel (App) und GitHub-Workflow (Edge Functions) deployen automatisch.
3. Vorübergehende Prüffunktion `nachrechnung-regeln` im Supabase-Dashboard löschen (liest nur, schreibt nichts).

## Nachtrag 16.11.2026: Gegenrechnung jeden Morgen in „Wo stehen wir?“
Uli: „Zeige mir die Gegenrechnung jeden Morgen in Wo stehen wir an.“ – Modus seit 07:24 „KI rechnet mit“, Komfort-Gewicht
auf Ulis Wunsch 1,5 → 0,6 (war seit 14.11. 06:35 über den Regler „Sparsamer ↔ wärmer“ auf 1,5).
- Neuer Abschnitt `src/components/ki/KiGegenRegeln.tsx` unter „Wo stehen wir?“ (Auto-Steuerung › 1): Ampel, ein Satz
  „bereit / noch nicht bereit“, Tabelle der letzten 7 Gegenrechnungen (Netz tatsächlich vs. KI, unter Min, Sonnentag).
- **Bereit für „KI steuert“**, wenn 3 Tage in Folge (mindestens ein Sonnentag) gilt: KI-Netz (bereinigt) ≤ tatsächlich,
  unter Min nicht mehr als tatsächlich (+0,5 °C·h), an Sonnentagen kein Netz-Heizen über Min. Nur Tage mit Regel-Rahmen.
- `heizplaner/rechnen.ts` `vergleichAus`: `planer` enthält zusätzlich `regeln`, `sonnentag`, `sonnen_ratio`,
  `netz_ueber_min_h` (keine Schemaänderung, jsonb).
- Die Karte „Wer steuert gerade?“ benutzt die neuen Modus-Namen.
- „Tatsächlich“ ist, was an dem Tag wirklich gesteuert hat – bis 16.11. früh war das die KI (Modus „steuern“), ab
  16.11. 07:24 die Regeln.
