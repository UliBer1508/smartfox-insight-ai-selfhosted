# FIX: Heizzyklen wurden nicht gespeichert – Datenbank-Trigger statt Insert vom Dienst

**Datum:** 26. Oktober 2026
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffen:** Datenbank (neue Funktion + Trigger auf `rooms`). Kein Frontend, keine Edge Function,
kein Neustart des lokalen Dienstes nötig.
**SQL:** `supabase/SQL/04_heizzyklen_trigger.sql`

## Befund

```sql
select event_type, count(*), max(timestamp) from room_heating_logs
where timestamp > now() - interval '30 days' group by 1;
```
| event_type | count |
|---|---|
| solar_limit_stop | 743 |

**Kein einziger `heating_start`/`heating_stop` in 30 Tagen.** Zwei Ursachen hintereinander:

1. **Falsches Datenfeld bis 24.10.:** Der lokale Treiber las bis v1.3 das Modus-DP statt DP 5 –
   `is_heating` war **immer false**. Ohne Zustandswechsel gab es nichts zu protokollieren.
2. **RLS seit 24.10.:** Mit v1.3 stimmt `is_heating`, aber der Insert des Dienstes (Block A2,
   anon-Schlüssel) scheitert: `room_heating_logs` hat nur die Policy für `authenticated`
   (offener Punkt seit `FIX-SPEICHER-UND-LOGS-2026-09-30.md` §3).

Betroffen: `ml-feature-extraction`, `calculate-heating-power`, `evaluate-decision`,
`compute-daily-score`, Heizverbrauch (`useHeatingConsumption`), aktive Räume
(`useActiveHeatingRooms`), Raum-Statistik (`useRoomHeatingLogs`), SQL-Auswertungen.

## Lösung: Trigger `trg_log_room_heating_transition`

`AFTER UPDATE OF is_heating ON rooms`, Funktion `log_room_heating_transition()` – gleiches Muster
wie `trg_capture_room_temperature_sample` (Temperatur-Samples, 30.09.).

| Entscheidung | Begründung |
|---|---|
| Trigger mit `SECURITY DEFINER` statt anon-INSERT-Policy | Der anon-Schlüssel steckt öffentlich im Frontend; eine Insert-Policy erlaubte jedem, Heizdaten zu fälschen. Der Trigger braucht keine neue Berechtigung. |
| Start nur ohne offenen Start, Stop nur mit offenem Start (< 12 h) | Kein Duplikat, wenn `tuya-control/sync-all` (Cloud) selbst schreibt – es schreibt **vor** dem `rooms`-Update. Kein Stop mit erfundener Dauer. |
| Stop mit `duration_minutes` + `energy_estimate_wh` | Alle Auswerter filtern auf Stop-Ereignisse mit Dauer und Energie > 0. Leistung: `calculated_power_w` → `heating_power_w` → Fläche × 60 W → 800 W (wie die SQL-Auswertung). |
| Zeitstempel = `last_thermostat_sync` | Zeitpunkt der echten Lesung, nicht des Trigger-Laufs. |
| `pv_surplus_w`, `consumption_at_start_w`, `consumption_during_avg_w` | Aus dem letzten `energy_readings`-Wert (≤ 10 min); Fronius: `power_io < 0` = Einspeisung. |
| Fehler → `WARNING`, Update läuft weiter | Ein Protokollfehler darf nie die Thermostat-Werte blockieren. |
| 12-h-Grenze statt 4 h (Cloud-Code) | Fußbodenheizung kann im Eco-Betrieb länger am Stück laufen; die 4-h-Grenze ersetzte längere Zyklen durch 2 Minuten. |

Wirkt für jeden Schreiber von `is_heating`: lokaler Dienst, Cloud-Sync, `pv-automation`
(Übertemperatur, Nacht). Auflösung = Takt des Dienstes (5 min).

## Test

Lokal gegen PostgreSQL 16 mit nachgebauten Tabellen geprüft:

| Fall | Ergebnis |
|---|---|
| false → true | `heating_start` mit Überschuss 2500 W, Verbrauch 900 W ✓ |
| erneuter Start ohne Stop | kein zweiter Start ✓ |
| true → false nach 50 min, 600 W | `heating_stop`, 50 min, 500 Wh ✓ |
| Stop ohne offenen Start | nichts geschrieben ✓ |
| Cloud: Start schon geschrieben, dann Update | kein Duplikat ✓ |

## Einspielen

Inhalt von `supabase/SQL/04_heizzyklen_trigger.sql` im Supabase SQL-Editor ausführen. Die
Kontrollabfrage am Ende muss `trg_log_room_heating_transition` mit `O` (aktiv) zeigen.
Rückweg: `drop trigger if exists trg_log_room_heating_transition on public.rooms;`

Nach 1–2 Stunden mit Heizbetrieb prüfen (Abfrage „Kontrolle 2“ in der SQL-Datei).

## Offen

1. **Block A2 im lokalen Dienst entfernen**, wenn der Dienst das nächste Mal angefasst wird. Er
   scheitert weiter harmlos an RLS (nur Konsolenmeldung). Bekäme anon je Schreibrecht, gäbe es
   doppelte Starts.
2. **`solar_limit_stop` wird als Heizenergie mitgezählt.** `pv-automation` schreibt bei jeder
   Absenkung einen `solar_limit_stop` mit geschätzter Energie (Raumleistung × Zeit seit
   Aktivierung, sonst 2 min) – 743 Stück in 30 Tagen, **ohne einen einzigen `solar_limit_start`**.
   Das ist eine Sollwert-Schätzung, kein gemessenes Heizen. Sobald echte `heating_stop` ankommen,
   zählen Verbrauch und Tageswertung beides zusammen. Entscheidung nach 1–2 Tagen Daten: echte
   Zyklen als alleinige Energiequelle, `solar_limit_*` nur noch als Steuer-Protokoll.
3. Doppel-Ordner im Repo: v1.3 liegt unter `local-collector/tuya-thermostat.js`, der Dienst-Ordner
   `local-collector/tuya-thermostat/` enthält noch v1.1.

## Gelernt

1. **Erst prüfen, ob überhaupt Daten entstehen können.** Die RLS-Sperre war bekannt – aber selbst
   ohne sie wäre nichts geschrieben worden, weil `is_heating` bis 24.10. nie wechselte.
2. **Trigger statt Berechtigung:** Wenn ein öffentlicher Schlüssel schreibt, ist ein
   `SECURITY DEFINER`-Trigger auf einer bereits erlaubten Tabelle sicherer als eine neue Policy.
3. **Duplikat-Schutz über den Zustand, nicht über die Zeit:** „Gibt es einen offenen Start?“
   ist robuster als „wurde in den letzten N Minuten geschrieben?“.
