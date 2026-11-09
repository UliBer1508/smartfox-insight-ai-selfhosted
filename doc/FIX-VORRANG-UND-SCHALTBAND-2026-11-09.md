# Fix: Vorrang behalten, Schaltband der Thermostate (09.11.2026)

**Status:** von Uli beauftragt 09.11.2026 („Alles umsetzen“) · DP 101 Wohnzimmer 1,0 → 0,5 °C (18:43) · SQL 29 ausgeführt · PR
**Betrifft:** `supabase/functions/pv-automation/index.ts` (`allocateUnderCap`, `allocateDayTargets`, Nachtverteilung,
`holdBelow`, neu `startTarget`, `attachBands`, `nextGrantState`), SQL `29_vorrang_schaltband.sql`, App
`HouseSettingsCard.tsx` (Haus › Verteilung), Typen.

## Anlass
09.11.2026, Uli: „Wieso wird im Wohnzimmer weiter geheizt?“ / „Warum ist das Wohnzimmer so kühl?“ – den ganzen Tag
19,5–20,1 °C bei Untergrenze 20,5 °C, nur ~95 min geheizt, abends heizte es trotz „wartet → 19 °C“ weiter.

## Befund 1: Vorrang hielt nur einen Lauf
`FIX-HEIZLEISTUNG-2026-11-06`: Ein Raum über der Grenze (Wohnzimmer 5550 W > 4000 W) darf allein heizen, wer 60 min
wartet, kommt zuerst dran. Im Code fiel der Raum nach dem Lauf mit „heizt allein“ aus `cap_wait_state` (nur Wartende
werden gespeichert) und verlor den Vorrang; im nächsten Lauf (2–7 min später) belegten Räume mit höherer Priorität die
Grenze, das Wohnzimmer wartete wieder 60 min. Am 09.11. sechsmal (`thermostat_commands`: 12:20/12:23, 13:23/13:30,
14:25/14:28, 15:30/15:30, 16:35/16:35, 17:38/17:45).

## Befund 2: Die TGP508 schalten bei Soll ± 1,0 °C (DP 101 wirkt nach beiden Seiten)
Alle „heizt an/aus“ im Protokoll seit 06.11. 20:09 (DP 19 = 0):

| Raum | aus bei Ist − Soll | an bei Ist − Soll |
|---|---|---|
| Bad Uli | +1,0 … +1,1 (6×) | −0,8 … −1,5 |
| Wohnzimmer | +1,0 … +1,1 (4×) | bis −1,0 |
| Toilette Eingang, Haustür, Zimmer Luis, Wirtschaftsraum | +0,6 … +1,3 | um −1,0 |

Folgen:
- Ein zugeteilter Raum innerhalb des Bandes (Ist zwischen Ziel − 1 und Ziel) **schaltet nicht ein**, belegt aber die
  Grenze. 09.11. 17:45: „Grenze belegt (3800 W)“ durch Bad Uli, Zimmer Uli, Kinder Bad, Haustür – keiner davon heizte.
- „Wartet → Ist − 0,5 °C“ **stoppt kein laufendes Thermostat** (aus erst bei Soll + 1). Das Wohnzimmer lief nach
  „wartet → 19 °C“ noch 25–30 min bis 20,0/20,1 °C weiter, mit 5,5 kW über der Grenze (13:33–13:58, 15:33–16:03, ab 17:43).
- Jeder Raum heizt bis Ziel + 1 °C, auch über Komfort.
- „Untergrenze 20,5 °C“ bedeutete faktisch „heizt erst ab 19,5 °C“ – daher 19,5–20,1 °C den ganzen Tag.

## Lösung (pv-automation)

**A) Wer heizt, heizt fertig.** `allocateUnderCap` ordnet zuerst Räume, die im letzten Lauf Leistung bekamen und
**wirklich heizen** (DP 5; 15 min Anlaufzeit nach der Zuteilung), dann Wartezeit-Vorrang, dann Priorität. Höchstens
`cap_keep_max_min` (120 min) am Stück. Zustand `system_settings.cap_wait_state.granted` (seit wann zugeteilt).
Zugeteilt, aber nicht heizend → behält nichts.

**A2) Reservierung.** Passt ein Raum mit Wartezeit-Vorrang nicht (Wohnzimmer), bekommen andere keine **neue** Leistung
und im Tagesmodus „ohne Sonne“ keinen Eco-Pass. Wer heizt, heizt fertig; danach ist die Grenze frei und der Raum heizt
allein. Ohne Sperre füllten kleine Räume die Grenze immer wieder auf (Nachrechnung).

**B) Warten heißt aus.** `holdBelow` = abgerundet Ist − Band − 0,5 °C (vorher Ist − 0,5). Band je Raum aus
`thermostat_state.dp101` (`attachBands`), sonst 1,0 °C.

**B2) Anstoß.** Ein zugeteilter Raum unter seinem Ziel, der nicht heizt, weil er im Band liegt, bekommt
Soll = aufgerundet Ist + Band + 0,2 °C (höchstens Komfort), damit das Thermostat einschaltet. Begründung im Protokoll
„Anstoß …“.

**B3) Abschalten am Ziel.** Ein heizender Raum ohne Zuteilung, der sein Ziel um `ziel_abschalt_ueber_c` (0,3 °C)
überschritten hat, wird abgeschaltet (holdBelow) – statt bis Ziel + Band weiterzuheizen. Gilt für Untergrenze/Nachtwert
im Tagesmodus, am Abend und nachts. PV-Phasen (Eco/Komfort mit Budget) unverändert.

B2/B3 nur im **Lokal-Modus** (zusätzliche Befehle; Cloud hat 30 Aufrufe/Tag).

**C) Gerät:** DP 101 Wohnzimmer 10 → 5 (Schaltband 0,5 °C), 09.11. 18:43 ausgeführt, gelesen 18:43:23 = 5. Test wie
DP 19 am Büro: Schaltpunkte nach einem halben Tag prüfen, dann über die übrigen Räume entscheiden.

## Nachgerechnet
Simulation 10 h ab 09.11. 12:20 mit den echten Starttemperaturen, Leistungen und Zielen (Abend/„ohne Sonne“), Grenze
4000 W, Thermostat als Relais mit Band (an ≤ Soll − Band, aus ≥ Soll + Band), Heizraten 1,2–2 °C/h (Wohnzimmer
1,2 °C/h, gemessen 09.11.: +0,5 °C in 25 min), Auskühlen 0,2 °C/h. Modell, keine Messung – zeigt die Richtung:

| | über der Grenze | Spitze | Sollwert-Befehle | Wohnzimmer Mittel ab 2 h | Wohnzimmer min. ab 2 h |
|---|---|---|---|---|---|
| alt (Band 1,0) | **125 min** | 7750 W | 50 | Ziel +0,37 °C | 20,2 °C |
| neu | **0 min** | 5550 W (Wohnzimmer allein) | 137 | Ziel +0,12 °C | 19,8 °C |

Übrige Räume neu: Zeit > 0,3 °C unter Ziel 0–55 min statt 125–245 min; Mittel Ziel +0,10…+0,18 °C statt bis +0,32.
Das Wohnzimmer ist im alten Lauf nur deshalb wärmer, weil wartende Räume (auch es selbst) trotz „wartet“ über der
Grenze weiterheizten. Mit Grenze 4000 W und 5,5 kW Wohnzimmer kann es zeitweise 0,5–0,7 °C unter die Untergrenze
fallen, während andere fertig heizen – das ist die Folge von „Grenze gilt immer“. Das Schaltband (1,0 oder 0,5) ändert
das Ergebnis in der Simulation kaum, weil Anstoß und Abschalten die Regelung übernehmen; DP 101 = 0,5 hilft dort, wo die
Automatik nicht eingreift (PV-Phasen Eco/Komfort, Cloud-Modus).

Bestehender Ablauf geprüft (09.11., `thermostat_commands` + Messwerte): 16:35 bekam das Wohnzimmer „heizt allein“ bei
19,8 °C (Soll 20,5). Das Thermostat schaltete nicht ein (im Band, an erst ≤ 19,5) und 16:35:45 kam schon „wartet → 19“.
Neu: Anstoß auf 21,0 °C → Thermostat schaltet ein, heizt → behält die Leistung → läuft, bis 20,8 °C (Ziel + 0,3)
erreicht sind, dann Abschalten. Die vier zugeteilten, aber nicht heizenden Räume (17:45, 3800 W) hätten im selben Lauf
einen Anstoß bekommen, falls Leistung frei war, sonst gewartet – ohne die Grenze zu blockieren.

## Nebenwirkungen geprüft

**1. Wer liest/schreibt dieselben Daten?**

| Stelle | nach der Änderung |
|---|---|
| `system_settings.cap_wait_state` | nur `pv-automation` (Tag + Nacht); neues Feld `granted`, alte Einträge ohne `granted` werden als leer gelesen |
| `thermostat_state.dp101` | nur gelesen (Dienst schreibt je Lesung); fehlt der Wert → Band 1,0 °C |
| `thermostat_commands` | mehr `set_temp` (Anstoß/Abschalten): Simulation ~14/h statt ~5/h – Lokal-Modus ohne Kontingent |
| `rooms.target_temp` / Stufe 4 (`tempAlreadyCorrect`) | unverändert; Anstoß-/Abschaltwerte sind normale Ziele |
| Übertemperatur-Gate (Stufe 1, Ist ≥ Soll + 0,4) | kann bei Anstoß nicht greifen (Soll > Ist) |
| Phase 1/2 (PV-Budget), Mikro-Budget, Komfort-Sättigung | nur Räume **ohne** Budget sind betroffen – unverändert |
| Manuell übersteuert, Fühler in der Sonne (SQL 28), Automatik aus | ausgenommen wie bisher |
| `heating_day_mode` / `heating_night_mode` (App „Automatik: …“) | neue Begründungen „behält Leistung bis Ziel“, „Anstoß …“, „… erreicht → Thermostat aus“ |
| Heizzyklen-Trigger, Protokoll | mehr, kürzere Zyklen (Abschalten bei Ziel + 0,3 statt + 1,0) |
| Heizplaner (Schatten), Leistungsmessung (`measure-room-power`) | lesen Messwerte; kürzere Zyklen = mehr saubere An/Aus-Wechsel für die Messung |
| App Einstellungen | zwei neue Felder (Haus › Verteilung); Code-Standard gilt auch ohne SQL 29 |

**2. Verhalten über Zeit**

| Verlauf | Ergebnis |
|---|---|
| Thermostat antwortet nach Anstoß nicht (offline) | heizt nicht → nach 15 min kein „behalten“; toter Raum ist nach 2 h `stale` |
| Raum erreicht Ziel nie (Leistung zu klein, Fenster offen) | behält höchstens 120 min, dann Vorrang/Priorität |
| Zwei große Räume mit Vorrang | der länger Wartende zuerst, der andere reserviert danach |
| Tag → Abend → Nacht | `granted` gilt weiter (Ziel wechselt auf Nachtwert); abgelaufene Einträge fallen heraus |
| Messung alle 5 min, Thermostat reagiert ≤ 5 min | Überschreiten um 0,1–0,3 °C über Ziel + 0,3 möglich |
| Cloud-Modus | kein Anstoß, kein Abschalten; „wartet“ jetzt Ist − Band − 0,5 (ein Befehl wie bisher) |

**3. Echte Daten:** siehe „Nachgerechnet“ und Befund 2 (Schaltpunkte aus `protokoll_events`).

**4. Umstellung:** SQL 29 optional vor dem Merge (nur Einstellungen). Beim ersten Lauf ist `granted` leer → wie bisher,
ab dem zweiten Lauf gilt „behalten“. Räume im Band bekommen sofort einen Anstoß → am Abend heizen mehr Räume als bisher
(bis zur Grenze, aus der Batterie) – gewollt: Nachtwert/Untergrenze werden wirklich gehalten.

**Bewusst nicht geändert**
- PV-Phasen (Eco/Komfort mit Budget) regeln weiter über das Thermostat-Band – mit DP 101 = 0,5 halbiert sich dort das
  Überschwingen. Entscheidung über DP 101 an allen Räumen nach dem Test.
- Grenze 4000 W und „Wohnzimmer nur bis Untergrenze, nicht bis Eco an Tagen ohne Sonne“ – Konzeptfrage an Uli (TODO).
- Kinder Bad DP 19 (−10) – TODO aus `FIX-FUEHLER-SONNE-UND-DP19-2026-11-09.md`.

## Rückweg
- „Wer heizt, behält Leistung höchstens“ = 0 → ohne Behalten/Reservierung.
- DP 101 Wohnzimmer zurück auf 10 über Protokoll › Thermostate.
- PR rückgängig machen (Revert).
