# FIX: Komfort-Budget – Doppelabzug, Puffer bei voller Batterie, Anstoß in Phase 1 (24.11.2026)

## Anlass
24.11.2026, ca. 13:20: volle PV (6,5–8,4 kW), Batterie 100 %, trotzdem heizte kaum ein Raum Richtung PV-Max (Komfort).
Zuerst nahm der Smartfox ~6 kW für Warmwasser (Uli hat Warmwasser auf 30 % begrenzt). Danach gingen 2,48 kW ins Netz –
und die Heizung verteilte sie immer noch nicht.

Lauf 13:27 (Log):

| | W |
|---|---|
| Einspeisung | 2 481 |
| − Grundlast-Puffer | −1 500 |
| + Trend | +26 |
| = Komfort-Budget | 1 007 |
| − „bereits verwendet“ (Eco-Räume) | −1 600 |
| = Rest für Komfort | **−593** |

## Ursachen
1. **Doppelabzug.** Das Komfort-Budget ist bewusst nur die echte Einspeisung (reaktive Strategie). Räume, die schon
   heizen, haben die Einspeisung aber bereits um ihre Leistung gesenkt. Phase 2 zog ihre Leistung trotzdem noch einmal
   ab (`usedComfortBudget = usedBudget`). Folge: wer heizt, frisst das Komfort-Budget zweimal; Haustür schaltete
   12:22 ein, 12:32 aus, 13:17 ein, 13:27 aus.
2. **Puffer bis 1 500 W.** Der Puffer kommt aus der Schwankung des Verbrauchs (σ × 1,5). Schaltet der Smartfox
   Warmwasser zu und ab, springt er auf 1 500 W – obwohl die Grundlast praktisch null ist und die volle Batterie
   kurze Spitzen abfängt.
3. **Eco-Räume im Schaltband heizen nie.** Phase 1 setzt Soll = Eco. Liegt der Raum weniger als das Schaltband
   (DP 101, 1,0 °C) darunter (Kinder Bad 20,5 °C, Waschraum 20,3 °C bei Eco 21 °C), schaltet das Thermostat nicht ein.
   Der Raum hielt trotzdem Eco-Budget fest (500 + 750 W), das für Komfort fehlte. Prüfung: **alle** 24 Phase-1-Sollwerte
   der letzten 9 Tage lagen im Schaltband (16.11.: 7, 17.11.: 1, 21.11.: 4, 24.11.: 12). Der Tagesmodus hatte dafür
   schon den Anstoß (09.11.2026), Phase 1 nicht.

## Änderungen (`supabase/functions/pv-automation/index.ts`)
1. **Phase 2:** Ein Raum, der gerade heizt, kostet kein Komfort-Budget – nur wenn seine Leistung aus überschüssiger
   Sonne kommt: Budget-Modus `pv_optimized`, kein Netzbezug (`power_io ≤ 50 W`), Batterie entlädt nicht und lädt nicht
   (≤ 100 W) bzw. ist ≥ 95 %. Sonst zählt er voll wie bisher. Gilt für den Startwert (Eco-Räume aus Phase 1) und für
   Komfort-Kandidaten.
2. **Puffer bei voller Batterie:** Batterie ≥ 95 % → Puffer höchstens `komfort_puffer_batterie_voll_w` (neu, 300 W,
   einstellbar unter Einstellungen › Verteilung auf die Räume).
3. **Phase-1-Gate:** Ein Raum unter Eco, der nur wegen der Ein-Schwelle (Einspeisung < `pv_surplus_threshold_on`)
   nicht starten darf, zählt als „Eco nicht fertig“. Sonst behielten Komfort-Räume nach Änderung 1 den ganzen
   Überschuss, und der Raum unter Eco käme nie dran (Regel: erst alle auf Eco, dann Komfort nach Priorität).
4. **Anstoß in Phase 1:** Liegt ein Eco-Raum im Schaltband und heizt nicht, bekommt er (nur Lokal-Modus) einen Anstoß
   wie im Tagesmodus: Soll = aufgerundet Ist + Band + 0,2 °C, höchstens Komfort. Schaltband dafür jetzt für alle Räume
   aus `thermostat_state.dp101`, nicht nur für Räume ohne Budget.

SQL: `supabase/SQL/56_komfort_puffer_batterie_voll.sql` (Code läuft auch ohne, Standard 300 W).
Frontend: neues Feld in `HouseSettingsCard.tsx`, Typen/Standardwert ergänzt.

## Nebenwirkungen geprüft (Regel 08.11.2026)
- **Wer liest dieselben Daten:** `comfortBudget` bleibt unverändert (UI „parallel_heating_capacity“ zeigt weiter die
  Einspeisung minus Puffer). Geändert ist nur, was Phase 2 davon als verbraucht zählt. Heizplaner (Modus Schatten)
  und Tagesmodus sind nicht betroffen. Der Puffer wirkt nur im Zweig `pv_optimized`.
- **Verhalten über Zeit:** Bricht die Sonne ein, entlädt die Batterie oder kommt Netzbezug → im nächsten Lauf zählen
  laufende Räume wieder voll (altes Verhalten), dazu greift wie bisher die PV-Zusage. Lädt die Batterie, gehört die
  Sonne ihr – kein Anrechnen. Der Anstoß setzt das Soll einmal höher; heizt der Raum, geht es im nächsten Lauf wieder
  auf Eco (gleiches Muster wie Tagesmodus). Kurzes Hin und Her mit der Ein-Schwelle (Änderung 3) ist gewollt: Komfort
  wartet, bis der Raum unter Eco läuft.
- **Nachgerechnet:** Die letzten 9 Tage hatte nur der 24.11. volle Batterie mit Einspeisung (an den anderen Tagen
  nahm die Batterie den Überschuss, Einspeisung ~0) – Änderung 1 und 2 hätten dort nichts geändert. Komfort-Ereignisse
  gab es nur am 16.11. (2) und 24.11. (8). Lauf 13:27 neu: Komfort-Budget 2 481 − 300 + 26 = 2 207 W; Büro heizt (kostet 0),
  Waschraum bekommt Anstoß (750 W) → Rest ≈ 1 450 W statt −593 W, im Lauf danach (Waschraum heizt) ≈ 2 200 W.
  Das reicht für 2–3 weitere Räume Richtung Komfort.

## Prüfen nach dem Einspielen
- Nächster Sonnentag mit voller Batterie: Log `=== PHASE 2: KOMFORT-RUNDE ===` – Rest positiv, „laufende kosten nichts“.
- Protokoll: Sollwerte „Phase 1: Eco … – Anstoß“ und danach „heizt an“.
- Kein Netzbezug/keine Batterie-Entladung durch Komfort-Räume (energy_readings `power_io`, `battery_power`).

## Offen
- Abwesenheit 24.11. 13:22 – 27.11. 14:00 per Schnellschalter eingetragen – prüfen, ob gewollt.
- Warum zwei pv-automation-Läufe je 5 min mit unterschiedlichem Puffer (300 / 1 500 W) im Log stehen – nicht Teil dieses Fixes.

## Nachtrag 24.11.2026 14:10 – Zählerwert-Zeitpunkt
**Befund nach dem Einspielen:** Ab 14:02 entlud die Batterie 1,6–1,8 kW (Verbrauch 7,4 kW bei 5,9 kW PV).
Der Zählerwert (`energy_readings`) kommt alle 5 min (:x2:10 / :x7:10), pv-automation läuft etwa alle 2,5 min. Der Lauf
dazwischen rechnet mit dem alten Zählerwert. Räume, die nach dem Zählerwert eingeschaltet hatten (Wirtschaftsraum, Büro,
Toilette Eingang heizt an 13:57:25, Zählerwert 13:57:10), meldeten schon „heizt“ und kosteten nach Änderung 1 nichts –
obwohl ihre Leistung noch nicht in der Einspeisung steckte. Derselbe Überschuss wurde zweimal verteilt.

**Korrektur:** Ein laufender Raum kostet nur dann kein Komfort-Budget, wenn sein letztes „heizt an“
(`room_heating_logs`, `heating_start`) mindestens 30 s vor dem Zählerwert liegt. Sonst zählt er voll, bis ein neuer
Zählerwert da ist. Kein „heizt an“ in 24 h oder Abfrage-Fehler → zählt voll (sicher).

**Nachgerechnet:** Lauf 13:55 (Zählerwert 13:52:10): Kinder Bad/Waschraum heizten ab 13:52:21–23 → neu 750 W verbraucht,
Rest 666 W statt 1 416 W. Lauf 14:00 (Zählerwert 13:57:10): Wirtschaftsraum/Büro/Toilette ab 13:57:25 → zählen voll, keine
zweite Verteilung.
