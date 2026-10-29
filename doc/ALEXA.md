# Alexa-Sprachsteuerung für Venediger

**Stand:** 29.10.2026 · **Status:** eingerichtet und getestet (Alexa-Simulator)

Venediger ist an den Alexa-Skill **„Meine Heizung“** angebunden. Skill und Edge Function liegen im Repo
**`heizung-muenchen`**, weil ein Skill beide Häuser bedient:

| | |
|---|---|
| Edge Function | `alexa-heizung` im Projekt `pflnniklvqbwjwrjswaz` (Code: `heizung-muenchen/supabase/functions/alexa-heizung/index.ts`) |
| Sprachmodell | `heizung-muenchen/alexa/interaction-model-de-DE.json` |
| Vollständige Doku | `heizung-muenchen/doc/ALEXA.md` (Einrichtung, alle Befehle, Fehlersuche) |

## Was Alexa in Venediger kann

Fragen: „Alexa, **frag** meine Heizung, …“ · Befehle: „Alexa, **sag** meine Heizung, …“.
Ohne „in Venediger“ gilt das Haus, in dem das Echo steht (Secret `ALEXA_VEN_DEVICES`), sonst München.
Räume, die es nur hier gibt („Bad Uli“, „Zimmer Luca“, „Kinderbad“), findet Alexa auch ohne Ortsangabe.

| Du sagst … | Alexa macht |
|---|---|
| „… wie hoch ist der Eigenverbrauch in Venediger?“ | PV, Akku, Netz jetzt; heute PV-Summe, Eigenverbrauchsquote, Autarkie (aus `energy_readings`) |
| „… wie warm ist es im Bad Uli?“ | `current_temp`, `target_temp`, heizt/heizt nicht, manuell bis, Warnung bei altem Thermostat-Sync |
| „… Status in Venediger“ | anwesend/leer, Tagesmodus (`system_settings.heating_day_mode`), heizende Räume, manuelle Räume |
| „… stelle das Zimmer Luca für drei Stunden auf 23 Grad“ | Übersteuerung wie in der App (siehe unten) |
| „… Zimmer Luca wieder automatisch“ / „… alle Räume in Venediger wieder automatisch“ | `rooms.manual_override_until` = leer |
| „… ich bin da bis Sonntag“ | Anwesenheit ab jetzt bis zum Datum (`presence_departure_time`, sonst 11:00); ohne Datum bis kommenden Sonntag 18:00 |
| „… ich bin weg“ | laufende Anwesenheit endet jetzt, künftige Einträge bleiben |
| „… bis wann sind wir eingetragen?“ | anwesend bis / leer, nächste Ankunft |

Einen Hauptschalter „Automatik aus“ gibt es für Venediger bewusst nicht.

## Schreibwege – bitte kompatibel halten

Die Function benutzt **dieselben Wege wie die App**. Wer diese Stellen ändert, muss die Alexa-Function mitziehen:

| Aktion | Weg | Vorbild in der App |
|---|---|---|
| Temperatur setzen, lokaler Modus | Insert `thermostat_commands` (`room_id`, `command: 'set_temp'`, `value`, `status: 'pending'`) | `useTuyaControl.setTemperature` |
| Temperatur setzen, Cloud-Modus | POST `tuya-control/set-temp` mit `deviceId`, `temperature`, `roomId` (service_role) | `useTuyaControl.setTemperature` |
| Modus-Auswahl | `system_settings.tuya_control_mode` → `value.mode` (`local` / `cloud`, Standard `cloud`) | `useControlMode` |
| Übersteuerung | `rooms.manual_override_until` + `target_temp` (Dauer 2–12 h); `pv-automation` lässt den Raum dann in Ruhe | `HouseOverview` |
| Anwesenheit | `presence_periods` (`source: 'quick'`, `note: 'Alexa'`); gleiche Regel wie `computePresence` / `getPresence` inkl. `presence_lead_hours` | `usePresence.arriveUntil` / `leaveNow` |
| Lesen | `rooms`, `energy_readings` (Fronius-Vorzeichen: `power_io` > 0 Bezug, < 0 Einspeisung), `system_settings.heating_day_mode`, `heating_settings` | – |

Grenzen beim Stellen: 5–26 °C; „warm machen“ ohne Temperatur = `comfort_temp` des Raums.

## Fehlersuche (Venediger)

| Symptom | Ursache |
|---|---|
| Befehl kommt an, Thermostat ändert nichts | lokaler Modus: Tuya-Dienst auf dem Mini-PC läuft? `thermostat_commands` bleibt sonst `pending` |
| „Messwerte … Minuten alt“ | Fronius-Collector auf dem Mini-PC prüfen |
| „Die Automatik hat seit über einer halben Stunde nichts berechnet“ | `pv-automation` läuft nicht (Cron / Watchdog) |
| Echo in Venediger meint München | Secret `ALEXA_VEN_DEVICES` setzen (Doku im München-Repo, Abschnitt 4.5) oder „… in Venediger“ sagen |
