# FIX: Nachts nur Min – früh abschalten, Nacht-Prüfung und Erfolgskontrolle in der KI (17.11.2026)

**Status:** von Uli beauftragt 17.11.2026 („erst prüfen, dann bauen, und Kontrolle in der KI, ob die Verbesserungen Erfolg bringen“)
**Betrifft:** `supabase/SQL/47_nacht_pruefung.sql` (neu), `supabase/functions/pv-automation/index.ts` (Nachtzweig),
`supabase/functions/ki-tagesanalyse/index.ts` (Regel 1, neue Regel 5, Erfolgskontrolle, Rückblick),
App `HouseSettingsCard.tsx` (Haus › Verteilung), Typen.

## Grundsatz (Uli, 17.11.2026)

> **Nachts nur Min halten, nie den Estrich laden. Den Estrich laden wir nur tagsüber mit PV-Überschuss, bis PV-Max.**
> „Das ist einer unserer Schlüssel zum Sparen.“

Steht seit heute ganz oben in `SYSTEM_DOCUMENTATION.md`. Jede Regeländerung wird dagegen geprüft.

## Anlass

17.11.2026, 06:30: Zimmer Uli und Zimmer Luis heizten nachts mit 5400 W aus dem Netz, Raumkarte „heizt bis 21,2 °C –
Anstoß 22,5 °C“. Uli: „Wieso heizen diese Zimmer auf diese hohe Temperatur?“ – Zimmer Uli stand um 06:55 bei 22,4 °C.
Uli: „Die KI sollte hier reagiert haben und eventuell eine Min-Änderung vorschlagen.“

## Befund (nur lesend geprüft, letzte 7 Nächte 20:00–08:00)

**1. Planung und KI laufen beide 24 h.** Die Planung (`pv-automation`, alle 2 min) hält nachts Min nach Priorität
(Leistungsgrenze, Deckel 6000 W für Räume unter Min). Die KI (`heizplaner`, alle 15 min, 24 h voraus) hat nachts
ebenfalls Min als harte Grenze. Sie kann deshalb nicht feststellen, ob ein anderes Min Netzstrom spart.

**2. Die Prüfung um 10:00 (`ki-tagesanalyse`) sah die Nacht nicht.** `ki_raum_tag` wertet nur 08:00–20:00 und die
Stunde vor 08:00 aus. Regel 4 („Min senken“) verlangte < 1 h am Tag unter Normal – die Schlafzimmer liegen tagsüber
8–12 h unter Normal (Leistungsgrenze), also kam nie ein Vorschlag. Regel 1 hätte aus denselben Daten sogar
„Min höher“ vorgeschlagen.

**3. Zu spätes Abschalten.** Der Abschaltbefehl kommt richtig bei Ziel + 0,3 °C (21,5 °C). Danach:

| Schritt | Dauer |
|---|---|
| Planung erkennt den Wert (Lauf alle 2 min) | bis 2 min |
| Befehl am Thermostat (Dienst Österreich-PC) | Ø 3 min |
| Messung zeigt „aus“ (alle 5 min) | bis 5 min |

In dieser Zeit heizt der Raum mit voller Leistung weiter (Zimmer Uli/Luis ~0,1 °C je Minute).

| Raum | Befehl bei | tatsächlich aus bei | Überlauf nach Befehl | Spitze über Min (Ø) |
|---|---|---|---|---|
| Bad Uli | 21,56 | 21,82 | 0,35 | 0,85 |
| Zimmer Uli | 21,52 | 22,04 | 0,67 | 1,12 |
| Zimmer Luis | 21,55 | 21,91 | 0,54 | 1,09 |
| Zimmer Luca | 21,54 | 21,99 | 0,57 | 1,20 |
| Kinder Bad | 21,23 | 21,44 | 0,28 | 0,95 |
| Büro | 21,31 | 21,71 | 0,54 | 0,88 |
| Wohnzimmer (Schaltband 0,5) | 21,01 | 21,15 | 0,31 | 0,14 |
| Wirtschaftsraum (Min 20) | 20,25 | 20,69 | 0,60 | 0,64 |
| Haustür | 21,38 | 21,77 | 0,40 | 0,82 |

Nach dem „aus“ heizt der Estrich nur noch 0,1–0,2 °C nach – die Annahme in `FIX-VORRANG-UND-SCHALTBAND-2026-11-09`
(„Überschreiten um 0,1–0,3 °C“) war zu optimistisch, gemessen wurde das nie. Heizstrom nachts zusammen ≈ 130 kWh in
7 Nächten (Heizminuten × Raumleistung).

Am 17.11. früh kam dazu: Uli hat um 06:35 die Thermostate von Hand auf 21 °C gestellt. Bei Schaltband ±1,0 °C schaltet
das Thermostat dann erst bei 22,0 °C ab; als „manuell“ steuerte die Automatik die Räume nicht mehr.

## Lösung

### A) Planung: nachts früh abschalten (`pv-automation`, nur Lokal-Modus)
- Neu je Raum: **gemessener Überlauf** = höchste Temperatur nach dem Abschalten − Temperatur beim Abschaltbefehl,
  gewichtetes Mittel der letzten 7 Nächte, mind. 3 Abschaltungen, 0…1,5 °C (`raum_ueberlauf`, stündlich).
- Ein heizender Raum wird nachts abgeschaltet, sobald **Ist + Überlauf ≥ Ziel + `nacht_spitze_ueber_ziel_c` (0,1 °C)**.
  Ziel = Min + Vorlauf. **Nie unter Min** (Schwelle = max(Min, …)). Die alte Regel (Ziel + 0,3 °C) bleibt dahinter.
- Danach **20 min Schutz** (`FRUEH_SCHUTZ_MIN`): kein neuer Anstoß, solange der Raum über Min bleibt. Ohne den Schutz
  läge der Raum noch unter „Min + Vorlauf“ und bekäme sofort wieder einen Anstoß (Hin und Her). Fällt er unter Min,
  heizt er sofort wieder (Min hart). Zustand in `system_settings.nacht_frueh_aus_state`.
- Früh abgeschaltete Räume zählen weiter zur Leistung, bis das Thermostat wirklich aus ist (wie Nachlauf).
- Raumkarte: „Min gehalten: 21,1 °C + gemessener Überlauf 0,7 °C erreicht 21,3 °C → Thermostat früh aus (nachts nur
  Min, Estrich nicht laden)“ bzw. „früh abgeschaltet um 06:34 – wartet den Überlauf ab …“.
- Einstellbar: Haus › Verteilung › „Nachts früh abschalten“ (an/aus), „Nachts höchstens Ziel +“ (0,1 °C).
- Ohne Messwerte für einen Raum (oder ohne SQL 47) → wie bisher.

### B) KI-Prüfung über die ganze Nacht (SQL 47, stündlich)
`ki_nacht_pruefen()` rechnet jede Stunde die laufende und die letzten Nächte je Raum: Heizminuten, Heiz-kWh, Zyklen,
Temperatur beim Abschaltbefehl, Spitze über Min, Überlauf, Abkühlen je Stunde (ohne Heizen), Temperatur zum
Nachtende, tiefste Temperatur. Tabelle `nacht_raum_kennzahlen`, pg_cron `ki-nacht-pruefen` (Minute 7, reines SQL).

### C) Vorschläge um 10:00 (`ki-tagesanalyse`)
- **Neue Regel 5 (Nacht):** Hat ein Raum in ≥ 3 der letzten 7 Nächte geheizt (≥ 0,3 kWh), um Min zu halten, und lag
  er zum Nachtende trotzdem auf Min → Vorschlag **Min − 0,5 °C** (nicht unter Normal − 2, Whitelist). Mit gemessenen
  Zahlen: kWh je Nacht, Spitze über Min, Abkühlen je Stunde → „etwa X Stunden länger ohne Heizen“. Uli genehmigt.
- **Regel 1 geändert:** „Morgens auf Min, tagsüber > 2 h unter Normal“ ergibt keinen Vorschlag „Min höher“ mehr,
  nur einen Hinweis. Die Ursache ist die Leistung am Tag (Grenze ohne Sonne, Regel 2), nicht Min – ein höheres Min
  hieße nachts mehr Netzstrom.
- **Rückblick** im Tagespaket: „Nachts geheizt: X kWh, um Min zu halten – über Min hinaus gelaufen: …“.

### D) Erfolgskontrolle in der KI
- **Früh abschalten (A):** täglich Vergleich der Nächte seit `nacht_frueh_aus_seit` mit den 7 Nächten davor:
  Spitze über Min und Heiz-kWh je Heizgradtag (alle Räume). Bis 3 Nächte „gemessen, Urteil nach 3 Nächten“, danach
  „wirkt“ (Spitze ≥ 0,15 °C tiefer, kWh/Heizgradtag nicht ≥ 5 % höher) / „keine klare Wirkung“ / „schlechter“ mit
  Hinweis auf den Schalter.
- **Genehmigtes niedrigeres Min (Regel 4/5):** nach 3 Nächten die Nächte dieses Raums vorher/nachher
  (kWh je Heizgradtag, neues Min zum Nachtende gehalten?). Schlechter → Rücknahme-Vorschlag wie bisher.

## Nachgerechnet (Nächte 10.–16.11., nur lesend)

| Raum | Spitze über Min heute | erwartet mit A | Regel 5: Nächte mit Heizen und Min gehalten |
|---|---|---|---|
| Bad Uli | 0,85 | ~0,45 | 5 → Vorschlag |
| Zimmer Uli | 1,12 | ~0,77 | 5 → Vorschlag |
| Zimmer Luis | 1,09 | ~0,64 | 4 → Vorschlag |
| Zimmer Luca | 1,20 | ~0,67 | 2 |
| Kinder Bad | 0,95 | ~0,38 | 2 |
| Büro | 0,88 | ~0,64 | 1 |
| Wirtschaftsraum | 0,64 | ~0,64 | 3 → Vorschlag |
| Haustür | 0,82 | ~0,50 | 2 |
| Wohnzimmer, Toilette, Waschraum | 0,02–0,26 | unverändert (A schaltet nur früher ab, nie später) | 0–2 |

„Erwartet“ = max(0,3; Überlauf + 0,1) – grob, weil ein Raum frühestens dann abschaltet, wenn er heizt (Anstoß bei
~Min + 0,1 °C). Höchstens 3 Vorschläge je Tag (bestehende Regel).

**Ehrliche Einordnung der Ersparnis:** Früh abschalten senkt die Spitze in den Schlafzimmern um ~0,4 °C. Nach der
Faustregel (~6 % Heizstrom je Grad) sind das nachts nur wenige Prozent. Der größere Hebel ist Min selbst (Regel 5) und
an Sonnentagen, dass die Wärme tagsüber aus PV statt nachts aus dem Netz kommt. Genau das misst die Erfolgskontrolle.

## Nebenwirkungen geprüft

**1. Wer liest/schreibt dieselben Daten**

| Stelle | Wirkung |
|---|---|
| `pv-automation` Nachtzweig | neue Zweige vor „heizt bis Ziel“; Kandidaten ohne früh abgeschaltete Räume; alte Abschaltregel unverändert dahinter |
| Haltezeit (Stufe A) | „früh aus“ ist zwingend (darf die Haltezeit brechen, wie „Min erreicht → aus“); Schutz-Zustand ohne Heizen schickt keinen Befehl (Soll bleibt) |
| Planer steuert (`planer_modus = steuern`) | Plan überschreibt den Nachtplan wie bisher; früh aus wirkt dann nicht (heute: Schatten) |
| `heizplaner` lernen/rechnen | liest Messwerte; kürzere Heizpulse nachts = mehr An/Aus-Wechsel für das Raummodell |
| `haltezeiten_lernen` (SQL 46) | misst Anstoß → „heizt“; unverändert |
| `measure-room-power` | braucht saubere An/Aus-Wechsel; kürzere Pulse ändern das nicht |
| Heizzyklen-Trigger, Protokoll | etwas mehr, kürzere Zyklen nachts |
| „Heizung jetzt“ / Raumkarte | liest `heating_night_mode.rooms[].why` – neue Texte |
| `ki_raum_tag`, Tagesnote | unverändert |
| `ki-tagesanalyse` Regel 4 | unverändert; Regel 5 läuft vorher, Regel 4 überspringt Räume mit Vorschlag |
| `system_settings` | neuer Schlüssel `nacht_frueh_aus_state` |

**2. Verhalten über Zeit**

| Verlauf | Ergebnis |
|---|---|
| Thermostat-Dienst aus | kein Heizen gemeldet → kein „früh aus“; Messwerte fehlen → `raum_ueberlauf` bleibt alt bzw. fällt bei < 3 Abschaltungen weg → wie bisher |
| Befehl kommt nicht an | Raum heizt weiter → nächster Lauf wieder „früh aus“ (gleicher Soll, kein Doppelbefehl); spätestens alte Regel Ziel + 0,3 |
| Raum fällt im Schutz unter Min | Schutz endet sofort, Raum ist Kandidat (Min hart) |
| Nacht → Tag (08:00) | Tagzweig ignoriert den Zustand; abgelaufene Einträge fallen nach 20 min heraus |
| Cloud-Modus | „früh aus“ aus (wie Anstoß/Abschalten, Befehls-Kontingent) |
| Überlauf ändert sich (Schaltband, Jahreszeit) | wird stündlich aus 7 Nächten neu gemessen |

**3. Echte Daten:** siehe Befund und „Nachgerechnet“.

**4. Umstellung:** SQL 47 zuerst (Tabellen, Spalten, Nachrechnen 8 Nächte, Cron). Ohne SQL 47 laufen beide Functions
wie bisher (Meldung im Log). `nacht_frueh_aus_seit` = Zeitpunkt von SQL 47 → Bezug der Erfolgskontrolle.

**Bewusst nicht geändert**
- Schaltband DP 101 = 0,5 °C an allen Räumen: weiter offen seit 10.11. (TODO). Wohnzimmer (0,5) zeigt die
  kleinste Spitze – Entscheidung mit den Kennzahlen der nächsten Nächte.
- Tagsüber (PV-Phasen) bleibt das Abschalten wie bisher.
- Heizplaner: Varianten „Min − 0,5 / − 1“ durchrechnen ist der nächste Schritt (Uli: „KI rechnet aufgrund der Muster,
  ob sie den Netzstrom reduzieren kann“) – eigener PR, wenn A–D laufen.

## Einspielen
1. SQL `47_nacht_pruefung.sql` im Supabase-SQL-Editor ausführen (oder Claude nach Ulis OK per Connector).
2. PR mergen → GitHub-Aktion deployt `pv-automation` und `ki-tagesanalyse`, Vercel die App.
3. Prüfen: `select * from raum_ueberlauf;` · Raumkarten nachts „früh aus“ · morgen 10:00 Tagespaket mit Nachtzeile.

## Rückweg
- Einstellungen › Haus › Verteilung › „Nachts früh abschalten“ aus → wie vorher.
- `select cron.unschedule('ki-nacht-pruefen');` · PR rückgängig machen (Revert).
