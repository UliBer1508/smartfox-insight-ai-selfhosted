# FIX: „Heizung jetzt“ zeigt Begründung je Raum und Hinweise „Netzstrom sparen“ (16.11.2026)

## Anlass

Uli am 16.11.2026 um 08:30: Laut Prognose kommt heute PV-Strom, trotzdem heizten Zimmer Luis, Kinder Bad, Toilette Eingang und
Waschraum aus dem Netz (Batterie 4 %). In der Karte „Heizung jetzt“ war nicht zu sehen, **warum** ein Raum heizt.
Wunsch: Begründung direkt in der Karte, dazu Vorschläge, wie sich Netzstrom sparen lässt. Mockup freigegeben („passt“).

Ursache heute früh (zur Einordnung):
- Nachtende stand auf 10:00. Im Nachtbetrieb läuft nur die Nachtregel „Min halten“, die PV-Prognose wird nicht ausgewertet.
- „Min hat Vorrang“ (14.11.) mit **Vorlauf 0,2 °C**: Räume heizen schon unter Min + 0,2 °C (21,2 °C), also auch über Min.
- Anstoß-Sollwert 22,5 °C (Schaltband ±1 °C) → Thermostate heizen nach Erreichen des Ziels nach.
- Um 08:33 wurden Luis, Kinder Bad und Waschraum manuell bis 10:33 auf 20,2 °C gestellt; die Automatik steuert sie bis dahin nicht.

## Änderung (nur Frontend, keine Edge Function, kein SQL)

| Datei | Änderung |
|---|---|
| `src/lib/heizungJetzt.ts` (neu) | Reine Logik ohne Datenbankzugriff: `grundFuer()` (Begründung je Raum), `sparHinweise()`, `klartext()` (Begründung lesbar), Formatierer, `roomPowerW` |
| `src/components/overview/HeatingNow.tsx` | Begründung unter jedem heizenden Raum, Kasten „Netzstrom sparen“; `useDayModeRooms` hierher verschoben; lädt jede Minute letzte Schaltbefehle (3 h), `thermostat_state` (Befund, DP 101) und die PV-Prognose von heute |
| `src/components/overview/HouseOverview.tsx` | `useDayModeRooms` nicht mehr doppelt, sondern aus `HeatingNow.tsx`; Karte bekommt `settings` und `dayRooms` |

### Begründung je heizendem Raum (Reihenfolge)

1. **Manuell** (`manual_override_until` aktiv) → „Manuell bis 10:33 (20,2 °C)“, ggf. „Thermostat heizt noch nach“
2. **Nicht steuerbar** (`nicht_steuerbar_seit`) bzw. **Sonne auf dem Fühler** (`fuehler_sonne_seit`)
3. **Thermostat heizt über Soll** (Befund aus `thermostat_state`) → gelb markiert
4. **Nachlauf**: Ist ≥ Soll, Thermostat meldet „heizt“ → „Ziel erreicht, Thermostat heizt nach (Anstoß 22,5 °C um 08:12)“
5. **Automatik**: Begründung aus `heating_night_mode`/`heating_day_mode` (frisch < 20 min), sonst Grund des letzten
   Schaltbefehls mit Uhrzeit. Emoji und interne Namen („Tagesmodus battery_gate“) werden in Klartext übersetzt.

Damit fehlt die Begründung auch nicht mehr bei übersteuerten Räumen (die stehen nicht in `heating_night_mode`) – dafür war
keine Änderung an `pv-automation` nötig, die Angaben stehen bereits in `rooms`.

### Hinweise „Netzstrom sparen“ (nur Anzeige, ändert nichts)

| Hinweis | Bedingung |
|---|---|
| Nachtende | Nachtbetrieb, Sonnenaufgang (`pv_forecasts.sunrise`) > 60 min vorbei, Netzbezug oder PV bald → Vorschlag Nachtende näher an den Sonnenaufgang |
| Nachlauf | Netzbezug, Räume heizen über ihr Ziel hinaus → Ursache Schaltband/Anstoß |
| Thermostat folgt nicht | heizender Raum mit Befund „über Soll“, nicht steuerbar oder Sonne auf dem Fühler |

Kein Hinweis „Vorlauf senken“: nachgerechnet am 16.11.2026 – Räume kühlen nahe Min mit 0,3–0,9 °C/h ab, mit Vorlauf
0,2 °C startete schon jeder zweite Heizvorgang unter Min. Ohne Vorlauf fielen Räume unter Min
(siehe `doc/FIX-BATTERIE-SCHUTZ-PINGPONG-2026-11-16.md`).

### Abweichung „gemessen ↔ laut Thermostaten“ wird erklärt statt erfragt (`erklaereAbweichung`)

Uli (16.11.2026, 09:30): „Es ist ein Fragezeichen hinter der Meldung. Ich kann hier nicht antworten und weiß die Antwort
nicht, das sollte doch die KI wissen.“ Bisher: „Ist die Leistung eines Raums zu hoch eingestellt, oder ist die Meldung
„heizt“ gerade erst gekommen bzw. veraltet?“ Jetzt prüft die Karte selbst:

1. **Messzeitpunkt:** Fronius liefert nur alle 5 min einen Wert. Räume, die nach der Messung eingeschaltet haben, zählen
   nicht; Räume, die seit der Messung aufgehört haben (`last_heating_end`), zählen mit. Messung älter als 7 min → kein
   Vergleich, Hinweis auf den Fronius-Collector.
2. **Zu wenig:** Die Karte sucht die Kombination der heizenden Räume, die am besten zur Messung passt (≤ 300 W Fehler), und nennt
   die übrigen: „Thermostat meldet heizt, zieht aber (noch) keinen Strom“.
3. **Zu viel:** mit Sonne wahrscheinlich Warmwasser (Heizstab, Smartfox), ohne Sonne ein Gerät im Haus.

Nachgerechnet: Beide Meldungen vom 16.11. (08:22 „1,4 kW weniger“, 09:22 „2,3 kW weniger“) waren der Messzeitpunkt –
Zimmer Luis heizte erst seit 08:25, Wirtschaftsraum (2,1 kW) erst seit 09:25. Die Karte meldet jetzt „passen zusammen“ mit
dieser Erklärung. Messung 09:27 (4,6 kW gegen 3,5 kW) → „1,1 kW mehr … wahrscheinlich Warmwasser“.

### „Heizt über Soll“ erst nach 15 min als Störung (11:19)

Uli (16.11.2026, 11:19): „Was soll ich hier machen?“ – Bad Uli und Waschraum standen als „Thermostat heizt über Soll – folgt
dem Befehl nicht“ in der Karte. Tatsächlich: Ausschaltbefehl 20 °C um 11:12, beim Auslesen 11:15 meldete DP 5 noch „heizt“,
die Messung 11:17 (0,7 kW) zeigt, dass beide keinen Strom mehr zogen. `thermostat_state.befund` ist eine Momentaufnahme.

- Kam der Befehl, der das Soll gesenkt hat, vor weniger als 15 min (`ABSCHALT_VERZOEGERUNG_MIN`): Art `abschalten`,
  Text „Ausschaltbefehl um … – Thermostat meldet beim letzten Auslesen noch „heizt“, das ist normal“, kein Warnhinweis.
- Erst danach Art `gestoert` mit konkretem Schritt (Wirkungsprüfung markiert „nicht steuerbar“; sonst Thermostat am Gerät
  aus- und einschalten). „Sonne auf dem Fühler“ zählt nicht mehr als Störung.
- Der Vergleich gemessen ↔ Thermostate nimmt Räume mit frischem Ausschaltbefehl zuerst heraus → 11:17: „passen zusammen“.

## Nebenwirkungen geprüft (Regel 08.11.2026)

1. **Wer liest/schreibt dieselben Daten:** Die Karte liest nur (`system_settings`, `thermostat_commands`, `thermostat_state`,
   `pv_forecasts`, `rooms`), schreibt nichts. RLS: alle vier Tabellen für `authenticated` lesbar (geprüft).
   Raumkarte und „Heizung jetzt“ nutzen jetzt denselben Hook `useDayModeRooms` – keine doppelte Abfrage-Logik.
2. **Verhalten über Zeit:** Abfrage einmal pro Minute (max. 300 Befehle der letzten 3 h). Liegt ein Raum genau am Soll, kann
   der Text zwischen „Nachlauf“ und „Automatik“ wechseln – reine Anzeige. Abgelaufene Übersteuerung zählt nicht mehr als manuell.
   Veraltete Tages-/Nachtbegründung (> 20 min) wird nicht gezeigt, dann gilt der letzte Schaltbefehl mit Uhrzeit.
3. **Gegen echte Daten nachgerechnet (16.11.2026, 09:15):** Büro, Haustür, Wirtschaftsraum → „Batterie-Schutz: knapp über
   Min (21.0 < 21 + 0.2 °C Vorlauf) → heizt bis 21.2 °C … (Befehl 09:17)“. Kinder Bad →
   „Manuell bis … (20,2 °C), Thermostat heizt noch nach“. Mit Nachtende 10:00 zusätzlich der Nachtende-Hinweis.

## Offen (nicht Teil dieser Änderung, Entscheidung Uli)

- **Pingpong Batterie-Schutz ↔ Min-Vorrang** – behoben in PR #68: Im selben `pv-automation`-Lauf setzt der SOC-Gate-Notfall-Stop
  (`[SOC-GATE-STOP]`, Grund „Batterie-Schutz (SOC …) → Min − Abstand = 21°C“) Räume auf Min, danach setzt die Raumschleife
  (Tagesmodus `battery_gate`, Min-Vorrang) dieselben Räume wieder auf 21,2 °C bzw. Anstoß 22,5 °C. Am 16.11. 09:02–09:18 bei
  Büro, Haustür, Toilette Eingang, Wirtschaftsraum alle 2–5 min. Doppelte Logik → eine der beiden sollte die andere ablösen.
- **Vorlauf aussetzen, wenn PV kommt** – nachgerechnet, nicht sinnvoll (siehe oben).
- Kinder Bad: Temperatur-Korrektur DP 19 steht noch auf −1,0 (alle anderen 0).
- Gerätekonfiguration (16.11. 11:15): Bad Uli und Toilette Eingang haben Fühlerwahl DP 110 = „3“ (alle anderen „1“ = Raumfühler),
  Bad Uli zusätzlich max. Sollwert DP 15 = 30 (andere 60). Klären, ob das gewollt ist (Bodenfühler?).
