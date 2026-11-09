# FIX: Betriebsmodus-Karte zeigt Infos wie Heizung München (09.11.2026)

## Anlass
Die Betriebsmodus-Karte in Heizung München zeigt, wer heizt (Ist → Ziel) und wie viele Räume warten.
Venediger zeigte nachts nur „Nachtabsenkung bis 08:00 · 2 von 12 Räumen heizen“.
Uli will dieselben Infos. Es geht nur um die Anzeige, an der Steuerung wird nichts geändert.

## Ursache
- `pv-automation` schreibt den Status seit dem 06.11.2026 tagsüber und abends nach `system_settings.heating_day_mode`, nachts nach `heating_night_mode`. Beide enthalten Leistungsgrenze, belegte Leistung und je Raum Ziel und Begründung.
- Die Karte (`ModeHero` in `src/components/overview/HouseOverview.tsx`) las nur `heating_day_mode` und blendete den Text nachts ausdrücklich aus. Die Raumliste und die Leistungsgrenze wurden nie angezeigt.
- Den Abend-Modus (`mode = evening`) zeigte die Karte nicht als eigenen Modus, nur als Nebenzeile.

## Änderung (nur Frontend)
- `ModeHero` liest nachts `heating_night_mode`, sonst `heating_day_mode`, wie die Raumkarten (`useDayModeRooms`).
- Neue Zeile wie in München: „↳ Grenze 4 kW, belegt 3,9 kW: es heizen 3 – Raum Ist → Ziel · … · n warten“.
  - Welche Räume heizen, kommt live aus `rooms.is_heating`; Ist ist `rooms.current_temp`.
  - Das Ziel kommt aus dem Status, ersatzweise aus `rooms.target_temp`.
  - Als wartend zählen Räume, deren Begründung „wartet“ enthält.
- Abends (Status frisch und `mode = evening`) heißt der Modus „Abend“, mit dem Text „Abend wie Nacht – Räume halten den Nachtwert, kein Eco aus der Batterie“.
- Nachts steht in der Fußzeile „seit 20:00“, der Wert kommt aus `night_start_time`.
- Die Tagesmodus-Zeile „ohne PV“ nennt die Watt nicht mehr selbst, weil sie jetzt in der neuen Zeile stehen.
- „fertig in ca.“ wie in München kommt noch nicht. Dafür fehlt im Frontend eine verlässliche Aufheizrate je Raum.

## Prüfung auf Nebenwirkungen
1. **Wer liest oder schreibt dieselben Daten:** Die Karte liest nur. Geschrieben werden `heating_day_mode` und `heating_night_mode` weiterhin ausschließlich von `pv-automation`. Kein Trigger, kein Cron und keine Steuerlogik sind betroffen.
2. **Verhalten über Zeit:** Die Karte zeigt nur Status, der jünger als 20 Minuten ist. Wenn `pv-automation` aussetzt, verschwindet die Zeile, statt alte Werte zu zeigen. Beim Wechsel Tag/Nacht wird der andere Schlüssel geladen, der Effekt hängt an `night`.
3. **Nachgerechnet mit Live-Daten** vom 09.11.2026 um 21:10: Status von 21:10, belegt 3900 von 4000 W. Es heizen 3 Räume (Toilette Eingang 19,3 → 20, Zimmer Uli 21,1 → 21, Bad Uli 21,2 → 21,5), es warten 0.
   Hinweis: Zimmer Uli heizt laut Thermostat noch leicht über Ziel. Das ist das Schaltband (DP 101) und kein Anzeigefehler.

## Einspielen
Den PR mergen; Vercel deployt automatisch. Es ist kein SQL nötig und keine Function muss deployt werden.
