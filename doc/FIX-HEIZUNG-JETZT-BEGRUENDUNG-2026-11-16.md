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
| Vorlauf | Netzbezug > 200 W, PV-Prognose der nächsten 3 h ≥ 2 kW, Räume heizen per Automatik, liegen aber schon auf/über Min → kW, die ohne Vorlauf nicht laufen würden; Vorschlag „Vorlauf vor Min“ (Einstellungen › Haus) senken |
| Nachtende | Nachtbetrieb, Sonnenaufgang (`pv_forecasts.sunrise`) > 60 min vorbei, Netzbezug oder PV bald → Vorschlag Nachtende näher an den Sonnenaufgang |
| Nachlauf | Netzbezug, Räume heizen über ihr Ziel hinaus → Ursache Schaltband/Anstoß |
| Thermostat folgt nicht | heizender Raum mit Befund „über Soll“, nicht steuerbar oder Sonne auf dem Fühler |

## Nebenwirkungen geprüft (Regel 08.11.2026)

1. **Wer liest/schreibt dieselben Daten:** Die Karte liest nur (`system_settings`, `thermostat_commands`, `thermostat_state`,
   `pv_forecasts`, `rooms`), schreibt nichts. RLS: alle vier Tabellen für `authenticated` lesbar (geprüft).
   Raumkarte und „Heizung jetzt“ nutzen jetzt denselben Hook `useDayModeRooms` – keine doppelte Abfrage-Logik.
2. **Verhalten über Zeit:** Abfrage einmal pro Minute (max. 300 Befehle der letzten 3 h). Liegt ein Raum genau am Soll, kann
   der Text zwischen „Nachlauf“ und „Automatik“ wechseln – reine Anzeige. Abgelaufene Übersteuerung zählt nicht mehr als manuell.
   Veraltete Tages-/Nachtbegründung (> 20 min) wird nicht gezeigt, dann gilt der letzte Schaltbefehl mit Uhrzeit.
3. **Gegen echte Daten nachgerechnet (16.11.2026, 09:15):** Büro, Haustür, Wirtschaftsraum heizen per „Batterie-Schutz:
   knapp über Min … Vorlauf“ → Hinweis „heizen nur wegen des Vorlaufs – 3,4 kW, PV um 10 Uhr 5,2 kW“. Kinder Bad →
   „Manuell bis … (20,2 °C), Thermostat heizt noch nach“. Mit Nachtende 10:00 zusätzlich der Nachtende-Hinweis.

## Offen (nicht Teil dieser Änderung, Entscheidung Uli)

- **Pingpong Batterie-Schutz ↔ Min-Vorrang:** Im selben `pv-automation`-Lauf setzt der SOC-Gate-Notfall-Stop
  (`[SOC-GATE-STOP]`, Grund „Batterie-Schutz (SOC …) → Min − Abstand = 21°C“) Räume auf Min, danach setzt die Raumschleife
  (Tagesmodus `battery_gate`, Min-Vorrang) dieselben Räume wieder auf 21,2 °C bzw. Anstoß 22,5 °C. Am 16.11. 09:02–09:18 bei
  Büro, Haustür, Toilette Eingang, Wirtschaftsraum alle 2–5 min. Doppelte Logik → eine der beiden sollte die andere ablösen.
- **Vorlauf aussetzen, wenn PV kommt** (Vorschlag vom 16.11.) – noch nicht entschieden.
- Kinder Bad: Temperatur-Korrektur DP 19 steht noch auf −1,0 (alle anderen 0).
