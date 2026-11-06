# Fix: Abend wie Nacht – kein Eco aus der Batterie nach Sonnenuntergang (06.11.2026)

**Betrifft:** `supabase/functions/pv-automation/index.ts`, App: `HouseOverview.tsx`, `HeatingNow.tsx`

## Anlass
Uli, 06.11.2026 19:43: „Wieso heizen wir jetzt und machen die Batterie leer?“ – „Warum um 19:00 auf 22? Das ist doch Quatsch.“

## Befund (Daten 06.11.2026)
- Sonnenuntergang ~15:30, Batterie 98 %. Danach Netzbezug praktisch 0 W – **alles kam aus der Batterie**.
  19:45 nur noch ~70 % (≈ 3,9 kWh seit Sonnenuntergang), Heizspitzen 17:30 (1,9 kW) und 19:00 (2,4 kW).
- Bad Uli (Ist 21,1 °C, Untergrenze = Nacht 21 °C, Eco 22 °C): 16:15, 17:40, 19:10 von der Automatik auf 22 °C
  („Tagesmodus grid: nach Sonnenuntergang → Eco → Eco aus Netz“), dazwischen zurück auf 21 °C. 19:18–19:43 geheizt.
- Ursache 1: Der „Tag“ endete erst mit `night_start_time` (20:00). Zwischen Sonnenuntergang und 20:00 lief
  Tagesmodus `grid` = Eco nach Priorität bis `max_grid_heating_power_w`. „Aus Netz“ ist physikalisch falsch:
  Der Fronius deckt jede Last aus der Batterie, solange sie über ihrem Minimum liegt.
- Ursache 2: Eigener „Abend-Modus“ (`batteryEcoReserveAllowed`): nach Sonnenuntergang und SOC > `heating_min_battery_soc`
  bekamen Räume ein Eco-Budget aus der Batterie („🔌 Grid-Heizen … Eco-Phase“).
- Ursache 3: `afterSunset` verglich nur die Stunde (Sonnenuntergang 16:xx → „nach Sonnenuntergang“ ab 16:00).

## Entscheidung (Uli, 06.11.2026)
„Ja“ zu: **Ab Sonnenuntergang gilt die Nachtlogik.** Ziel = Nachtwert bzw. Untergrenze, kein Eco.
Die Batterie ist für die Nacht.

## Änderungen
- Neuer Tagesmodus **`evening`** (hat Vorrang vor allen anderen Tagesmodi, sobald die Sonne untergegangen ist):
  Ziel je Raum = max(Nachtwert, Untergrenze) – dieselbe Regel wie nachts („Nachtwert halten“).
  Räume darunter heizen nach Priorität unter `max_grid_heating_power_w` (Grenze gilt immer, Wartezeit-Vorrang wie gehabt).
  Kein Eco-Pass.
- `batteryEcoReserveAllowed` immer `false` – kein Eco-Budget aus der Batterie am Abend.
- `afterSunset` minutengenau aus `pv_forecasts.sunset` (Wiener Zeit).
- App: Übersicht zeigt „Abend: nach Sonnenuntergang wie Nacht …“, Karte „Heizung jetzt“ zeigt „Abend“.
- Unverändert: Nacht (ab `night_start_time`), Tag vor Sonnenuntergang, Sonnentag/Wartetag/Batterie-Schutz.

## Einspielen
PR mergen → GitHub-Aktion deployt `pv-automation`, Vercel die App.

## Prüfen
- Nach Sonnenuntergang: `system_settings.heating_day_mode.mode = 'evening'`, Raumbegründung „Abend … hält Nachtwert“.
- Keine `set_temp` auf Eco zwischen Sonnenuntergang und Nachtbeginn in `thermostat_commands`.
- Batterie-Verlauf am Abend gegen 06.11. vergleichen.
