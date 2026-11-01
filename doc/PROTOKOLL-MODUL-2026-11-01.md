# Test- und Protokoll-Modul (01.11.2026)

**Status:** FREIGEGEBEN (Uli, 01.11.2026, nach Mockup) · **Ziel:** sehen, was Steuerung und Thermostate
tatsächlich tun – ohne Einzel-Skripte – und daraus ableiten, welche Einstellung zu ändern ist.

## Anlass

Am 31.10. war die Batterie um 17 Uhr leer. Erst mit mehreren Hand-Abfragen und `dump-dps.js` ließ sich
klären, dass das Wohnzimmer (2,4 kW) den ganzen Nachmittag über seinem Sollwert heizte. Die Auswertung
der Schaltpunkte (01.11., 3 Tage) zeigte dann: **Die Thermostate regeln nicht auf den Sollwert, sondern
etwa 0,7 °C darüber** (Wohnzimmer 40 Zyklen: ein bei Soll +0,65, aus bei Soll +0,69 °C). Verdacht:
DP 19 = −10 (Temperatur-Korrektur −1,0 °C) wirkt auf die Regelung, nicht auf die gemeldete Temperatur.

## Aufbau

| Teil | Wo | Was |
|---|---|---|
| Ereignis-Protokoll | Tabelle `protokoll_events`, gefüllt nur durch Trigger (SQL 11) | Sollwerte mit Begründung (gleiche Werte nicht doppelt), heizt an/aus, Tagesmodus-Wechsel, Einstellungen Räume/Haus alt → neu, Übersteuern, Abwesenheit, Thermostat-Auffälligkeiten, Fehler |
| Thermostat-Zustand | `thermostat_state` (letzter Stand aller DPs), `thermostat_dp_log` (jede Änderung außer DP 3/5) | geschrieben vom Dienst v1.4 über RPC `thermostat_state_upsert` |
| Auffälligkeiten | in `thermostat_state_upsert` | Modus ≠ home · ausgeschaltet · Sollwert am Gerät weicht > 0,2 °C vom letzten Befehl ab · heizt und Ist > Soll + 0,3 → Eintrag im Protokoll (nur bei Änderung) |
| Begründung | `thermostat_commands.reason`, geschrieben von `pv-automation` | Nacht, Batterie-Schutz, Über-Temperatur, Mikro-Heizen, Raum-Entscheidung (`reasoning`) |
| Test-Befehle | `thermostat_commands.command` = `read_now` / `set_dp` | Dienst v1.4: Gerät sofort auslesen bzw. DP 19 / DP 101 schreiben (Whitelist, Grenzen −50…50 bzw. 1…50) und sofort zurücklesen |
| Auswertungen | RPC `protokoll_schaltpunkte(tage)`, `protokoll_energie_stunden(tag)`, `protokoll_energie_raeume(tag)` | Schaltpunkte je Raum (nur Sollwerte, die ≥ 30 min galten), Verbrauch je Stunde gegen heizende Räume, Heiz-kWh je Raum nach Quelle |
| App | Tab **Protokoll** (`src/components/protokoll/ProtokollTab.tsx`) | Ereignisse · Thermostate (Live-Tabelle, Schaltpunkte, Rohdaten, „Alle jetzt auslesen“, „Thermostat-Einstellung testen“) · Energie · Nächte |
| Aufräumen | Cron `protokoll-aufraeumen` 03:17 | Protokoll 180 Tage, DP-Log 90 Tage |

Alle Trigger sind `security definer`, schreiben über `protokoll_add()` und brechen den eigentlichen
Schreibvorgang nie ab (Fehler → WARNING).

## Einspielen (Reihenfolge)

1. **SQL** `supabase/SQL/11_protokoll_modul.sql` im SQL-Editor komplett ausführen. Danach füllt sich
   das Ereignis-Protokoll sofort (Sollwerte, heizt, Modus, Einstellungen, Fehler).
2. **pv-automation** deployen (Österreich-PC, `C:\Heizung\repo`): `git pull`, `supabase functions deploy pv-automation`
   → Begründungen erscheinen.
3. **Thermostat-Dienst v1.4** (Österreich-PC):
   ```powershell
   copy C:\Heizung\repo\local-collector\collector-node\tuya-thermostat.js C:\Users\ulibe\tuya-thermostat\
   copy C:\Heizung\repo\local-collector\collector-node\index.js C:\Users\ulibe\tuya-thermostat\
   nssm restart SmartfoxTuya
   ```
   → Tab Protokoll › Thermostate füllt sich, Test-Befehle funktionieren.
   (Der Fronius-Dienst braucht das neue `index.js` nicht.)
4. **App** kommt über Vercel nach dem Merge.

## Erster Test: Temperatur-Korrektur (DP 19)

1. Protokoll › Thermostate › „Thermostat-Einstellung testen“: Büro, DP 19, Wert **0**.
2. Im Protokoll erscheint „Datenpunkt 19 gesetzt“ und „Datenpunkt 19: −10 → 0“.
3. Prüfen: Ändert sich die gemeldete Ist-Temperatur sofort um ~1 °C? (Dann wirkt DP 19 auf die Anzeige.)
4. Nach einem halben Tag: Spalten „Ein bei / Aus bei“ für das Büro. Liegen sie um 0 statt um +0,7,
   regelt das Thermostat jetzt auf den Sollwert → alle umstellen.

## Offen

- Bedeutung der Datenpunkte: `doc/THERMOSTAT-DATENPUNKTE.md` (Recherche 01.11.2026).
- Haustür und Toilette Eingang haben keine Heizleistung (`heating_power_w` leer) → zählen in Energie-
  abgleich und Netzgrenze mit 0 W. In Einstellungen › Räume eintragen.
- `pv-automation` schickt teils alle 5 min denselben Sollwert (z. B. Kinder Bad am 31.10.). Im Protokoll
  ausgeblendet; die Ursache ist noch zu suchen.
