# Konzept: Anwesenheit – „Ich bin da / Ich bin weg“

**Stand:** 28. Oktober 2026 · **Status:** FREIGEGEBEN (Uli, 28.10.2026) – umgesetzt, Testphase
**Supabase:** `pflnniklvqbwjwrjswaz` · **Betrifft:** `pv-automation`, `heating_settings`, neue Tabelle
`presence_periods`, App (Übersicht, Einstellungen)
**Baut auf:** `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`

---

## 1. Ausgangslage

Das Haus ist nicht immer bewohnt. Bis 28.10.2026 heizte die Steuerung immer so, als wäre jemand da:
Eco aus dem Netz an Tagen ohne Überschuss (bis 2000 W), Komfort bei Überschuss.

## 2. Messung: Lohnt sich eine tiefere Temperatur bei Abwesenheit?

Gemessen am 28.10.2026 mit den Nächten seit 24.10. (Thermostate auf Frostschutz 5 °C, kein Heizen):

| Raum | Abfall je Nacht | Zeitkonstante |
|---|---|---|
| Wirtschaftsraum, Wohnzimmer, Toilette Eingang | 0,7–0,9 °C | ~230–250 h |
| Zimmer Luis, Haustür, Büro, Zimmer Uli, Bad Uli | 0,5–1,1 °C | ~280–400 h |
| Zimmer Luca, Flur, Kinder Bad, Waschraum | 0,1–0,3 °C | ~650–1200 h (Innenräume, von Nachbarn mitgewärmt) |

Außen ~3,5 °C. **Das Haus ist sehr träge** (Estrich): ohne Heizen ~1 °C Verlust pro Tag bei mildem
Wetter, ~1,5 °C bei Frost. Gespeicherte Wärme ~7 kWh je 1 °C Raumtemperatur (Schätzung).

| Abwesenheit | 1 °C tiefer | 2 °C tiefer |
|---|---|---|
| 2 Tage | 3–5 % | 3–8 % |
| 5 Tage | 3–5 % | 6–10 % |
| 14 Tage | 4–6 % | 7–11 % |

(Anteil der Heizenergie während der Abwesenheit, Wiederaufheizen eingerechnet; bei Frost die
niedrigeren Werte.) Wiederaufheizen braucht physikalisch nie mehr Energie, als das Absenken spart –
teurer wird es nur, wenn es aus dem Netz statt aus PV kommt.

**Ergebnis:** Eine eigene, tiefere Temperaturebene („Eco abwesend“) lohnt sich nicht. Der Hebel ist,
bei leerem Haus **kein Netz-Eco** zu heizen: Das träge Haus überbrückt trübe Tage aus dem Speicher und
lädt am nächsten Sonnentag mit PV nach. Datenbasis ist dünn (Heizzyklen erst seit 26.10. sauber) –
in 2–3 Wochen mit kälteren Tagen nachrechnen.

## 3. Regeln

| Zustand | Wann | Steuerung |
|---|---|---|
| **Anwesend** | Kalender-Eintrag läuft, oder Vorlauf davor | unverändert (Tagesablauf 27.10.) |
| **Abwesend** | sonst | **jeder Tag ist ein Wartetag**: Räume halten „Ohne PV“ (`wait_min_temp`), aus dem Netz nur darunter (nach Priorität, `max_grid_heating_power_w`); PV-Überschuss lädt weiter bis **Eco**; **kein Komfort** (Phase 2 aus, alle Ziele höchstens Eco) |
| Nacht | `night_start_time`–`night_end_time` | unverändert (Frostschutz), anwesend wie abwesend |

- Kein neuer Temperaturwert: Die Absenkung ist „Ohne PV“, also an Eco gekoppelt (Standard Eco − 1,5 °C)
  und je Raum fest einstellbar.
- **Vorlauf** `presence_lead_hours` (Standard 6 h): so lange vor einem Eintrag gilt schon „anwesend“.
- **Batterie-Gate** hat weiter Vorrang (Batterie-Schutz).
- **Übersteuern** in der Übersicht wirkt auch bei Abwesenheit.
- **Ausschalter** `presence_control_enabled`: aus = immer anwesend (Verhalten bis 28.10.2026).
- **Fail-safe:** Kalender nicht lesbar (Tabelle fehlt, Fehler) → anwesend.

## 4. Bedienung

| Was | Wo |
|---|---|
| Zustand, „Ich bin da bis …“ (Standard: kommender Sonntag 18:00), „Ich bin weg“ | Übersicht, Karte „Anwesenheit“ |
| Kalender: Von – Bis – Notiz, laufende Einträge „Jetzt beenden“, künftige löschen | Einstellungen › Anwesenheit |
| Anwesenheit steuern an/aus, Vorlauf | Einstellungen › Haus › Anwesenheit |
| Tagesmodus „Abwesend – Räume halten ‚Ohne PV‘ …“ | Übersicht › Betriebsmodus |

„Ich bin weg“ beendet laufende Einträge sofort; künftige bleiben stehen.

## 5. Umsetzung 28.10.2026

| Teil | Datei | Änderung |
|---|---|---|
| Datenbank | `supabase/SQL/07_anwesenheit.sql` | Tabelle `presence_periods` (mit RLS-Policy), `heating_settings.presence_control_enabled` (true), `presence_lead_hours` (6) |
| Steuerung | `supabase/functions/pv-automation/index.ts` | `getPresence()`; abwesend → Tagesmodus `wait` (nach `battery_gate`, vor „nach Sonnenuntergang → grid“), Phase 2 übersprungen, Deckel höchstens Eco; Protokoll in `heating_day_mode` (`away`, `presence_reason`, `presence_next_start`) |
| App | `src/hooks/usePresence.ts`, `src/components/presence/Presence.tsx` | Zustand (gleiche Regel wie Backend), Schnellschalter, Kalender |
| App | `overview/HouseOverview.tsx`, `energy/SettingsPanel.tsx`, `settings/HouseSettingsCard.tsx` | Karte Anwesenheit, Abschnitt Anwesenheit, Gruppe Haus › Anwesenheit |
| Typen | `src/types/heating.ts`, `src/integrations/supabase/types.ts` | neue Felder und Tabelle |

**Geprüft:** Deno-Typprüfung `pv-automation` – 38 Fehler vorher wie nachher (bekannte Altfehler).
`getPresence` mit 7 Fällen durchgespielt (leer, läuft, Vorlauf 3 h, Ankunft in 10 h, vorbei, aus,
Lesefehler) – alle richtig. `tsc` nur die 3 bekannten Altfehler, `vite build` ok.

**Einspielen (Reihenfolge):**
1. `07_anwesenheit.sql` im SQL-Editor ausführen. **Ab dann gilt das Haus als leer, solange kein
   Eintrag da ist.** Wer gerade dort ist: sofort „Ich bin da bis …“ eintragen.
2. `supabase functions deploy pv-automation` (Österreich-PC, `C:\Heizung\repo`).
3. App kommt über Vercel nach dem Merge.

### Testphase – woran man es erkennt

```sql
select value->>'mode' as modus, value->>'away' as abwesend, value->>'presence_reason' as grund,
       value->>'grid_used_w' as netz_w,
       (value->>'computed_at')::timestamptz at time zone 'Europe/Vienna' as stand
from system_settings where key = 'heating_day_mode';

select start_at at time zone 'Europe/Vienna' as von, end_at at time zone 'Europe/Vienna' as bis, note, source
from presence_periods order by start_at desc limit 10;
```

## 6. Offen

1. Abwesenheitstage im Mustergedächtnis (`daily_pattern_scores`, `best_match_today`) und in der
   Analyse („Eingespeist, während Räume unter Komfort“) kennzeichnen bzw. ausklammern.
2. Nachrechnen der Ersparnis mit kälteren Tagen (Abfragen im Anhang).
3. Später möglich: Handy im WLAN (FritzBox) setzt „anwesend“ automatisch – nie automatisch „weg“.

## Anhang: Mess-Abfragen

**Auskühlung je Raum (Nächte ohne Heizen):**
```sql
with s as (
  select r.name, t.timestamp at time zone 'Europe/Vienna' as lt, t.temperature, t.is_heating
  from room_temperature_samples t join rooms r on r.id = t.room_id
  where t.timestamp > now() - interval '10 days'
),
n as (
  select name, (lt - interval '12 hours')::date as nacht, min(lt) as t0, max(lt) as t1,
         (array_agg(temperature order by lt))[1] as temp0,
         (array_agg(temperature order by lt desc))[1] as temp1,
         bool_or(is_heating) as heizte
  from s where lt::time >= '22:30' or lt::time < '07:30' group by 1, 2
),
w as (  -- weather_data speichert Wiener Ortszeit als UTC
  select ((timestamp at time zone 'UTC') - interval '12 hours')::date as nacht, avg(temperature_c) as aussen
  from weather_data
  where (timestamp at time zone 'UTC')::time >= '22:30' or (timestamp at time zone 'UTC')::time < '07:30'
  group by 1
)
select name, count(*) as naechte, round(avg(temp0)::numeric, 1) as abends, round(avg(temp1)::numeric, 1) as morgens,
       round(avg(temp0 - temp1)::numeric, 1) as abfall_k, round(avg(aussen)::numeric, 1) as aussen,
       round(avg(tau)::numeric, 0) as zeitkonstante_h
from (select n.*, w.aussen,
             extract(epoch from n.t1 - n.t0) / 3600 / nullif(ln((n.temp0 - w.aussen) / nullif(n.temp1 - w.aussen, 0)), 0) as tau
      from n join w using (nacht)
      where not n.heizte and n.temp0 > n.temp1 and n.temp1 > w.aussen) x
group by name order by zeitkonstante_h;
```

**Heizenergie je Grad-Tag:**
```sql
with h as (
  select (timestamp at time zone 'Europe/Vienna')::date as tag, round(sum(energy_estimate_wh) / 1000.0, 1) as heiz_kwh
  from room_heating_logs where event_type = 'heating_stop' and timestamp >= '2026-10-26' group by 1
),
i as (select (timestamp at time zone 'Europe/Vienna')::date as tag, avg(temperature) as innen
      from room_temperature_samples where timestamp >= '2026-10-26' group by 1),
w as (select (timestamp at time zone 'UTC')::date as tag, avg(temperature_c) as aussen
      from weather_data where timestamp >= '2026-10-26' group by 1)
select tag, heiz_kwh, round(innen::numeric, 1) as innen, round(aussen::numeric, 1) as aussen,
       round((heiz_kwh / nullif(innen - aussen, 0))::numeric, 2) as kwh_pro_grad_tag
from h join i using (tag) join w using (tag) order by tag;
```
