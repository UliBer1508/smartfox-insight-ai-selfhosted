# Test: Nachtwert halten statt Frostschutz (ab 01.11.2026)

**Status:** läuft · **Entschieden:** Uli, 01.11.2026 · **Protokoll:** Tabelle `nacht_protokoll` (SQL `10_nacht_protokoll.sql`)

## Frage

Frostschutz 5 °C nachts war eine Notlösung, solange die Thermostate im Modus „auto“ die Sollwerte
überschrieben (bis v1.3, 24.10.2026). Seit v1.3 halten sie den Sollwert. Ist **„Nachtwert halten“**
(`night_heating_mode = maintain`) besser – wärmere Räume morgens, ohne die Batterie nachts leerzuziehen?

## Einstellungen im Test

| Wert | Frostschutz (bis 31.10.) | Test ab 01.11. |
|---|---|---|
| Nachtmodus (Haus › Nacht) | `frost_only` (5 °C) | `maintain` |
| Nachtwert je Raum | – | **= Untergrenze** (z. B. Zimmer Uli Eco 21 / Untergrenze 20 / Nacht 20) |
| Untergrenze | Eco − 1,5 | Wohn-/Schlafräume Eco − 1, Bäder Eco − 0,5, Nebenräume Eco − 1,5 |

Der Nachtwert ist eine **Grenze nach unten**, kein Ziel: Das Haus verliert nachts 0,5–1 °C, in milden
Nächten heizt also kein Raum. Nur in kalten Nächten fängt das Thermostat den Raum ab.

## Was protokolliert wird

Jeden Abend um 21:55 (Wiener Zeit) merkt `nacht_einstellungen_merken()` je Raum Nachtmodus, Nachtwert,
Untergrenze, Eco, Komfort und die Nachtzeiten. Um 09:55 wertet `nacht_auswerten()` die Nacht aus:

| Spalte | Quelle |
|---|---|
| `temp_abends`, `temp_morgens`, `temp_min` | `room_temperature_samples` im Nachtfenster |
| `heiz_min`, `heiz_kwh` | `room_heating_logs` (`heating_stop`) im Nachtfenster |
| `aussen_avg`, `aussen_min` | `weather_data` (Ortszeit als UTC gespeichert) |
| `soc_abends`, `soc_morgens`, `netz_kwh` | `energy_readings` (Haus, je Zeile wiederholt) |

Vergleichsbasis: Frostschutz-Nächte 26.–31.10. nachgetragen (`quelle = 'nachgetragen'`; Raumwerte
sind die vom 01.11., die alten wurden nicht gespeichert).

## Auswertung

**Je Nacht (Haus):**
```sql
select nacht, modus, max(aussen_avg) as aussen, max(aussen_min) as aussen_min,
       round(avg(temp_morgens), 1) as morgens_schnitt, round(min(temp_morgens - untergrenze), 1) as knappster_raum_k,
       sum(heiz_kwh) as heiz_kwh, max(netz_kwh) as netz_kwh,
       max(soc_abends) as soc_abends, max(soc_morgens) as soc_morgens
from nacht_protokoll where ausgewertet_at is not null
group by nacht, modus order by nacht;
```

**Je Raum, Frostschutz gegen Nachtwert:**
```sql
select raum, modus, count(*) as naechte, round(avg(aussen_avg), 1) as aussen,
       round(avg(temp_abends - temp_morgens), 2) as abfall_k,
       round(avg(temp_morgens - eco), 1) as morgens_unter_eco_k,
       round(avg(heiz_kwh), 2) as heiz_kwh_je_nacht
from nacht_protokoll where ausgewertet_at is not null
group by raum, modus order by raum, modus;
```

**Morgen danach** (Netzbezug 08–11 Uhr – heizt die Steuerung morgens weniger, wenn die Räume wärmer sind?):
```sql
select (timestamp at time zone 'Europe/Vienna')::date as tag,
       round(sum(greatest(power_io, 0)) filter (where extract(hour from timestamp at time zone 'Europe/Vienna') between 8 and 10) / 12000.0, 1) as netz_kwh_8_11_ca
from energy_readings where timestamp > '2026-10-26' group by 1 order by 1;
```
(grobe Schätzung bei 5-Minuten-Werten; Abstand der Messwerte vorher prüfen)

## Bewertung – woran „besser“ gemessen wird

1. **Räume morgens:** kein Raum unter Untergrenze (`knappster_raum_k` ≥ 0).
2. **Batterie:** `soc_morgens` nicht deutlich tiefer als bei Frostschutz bei ähnlicher Außentemperatur; Netzbezug nachts (`netz_kwh`) nicht höher.
3. **Gesamt:** Nacht-Heizen + Morgen-Netzbezug zusammen nicht höher als bei Frostschutz.

Immer Nächte mit ähnlicher Außentemperatur vergleichen. Nach 1–2 Wochen hier eintragen:

| Zeitraum | Modus | Nächte | Außen | Heiz kWh/Nacht | Netz kWh/Nacht | SOC morgens | knappster Raum | Ergebnis |
|---|---|---|---|---|---|---|---|---|
| 26.–31.10. | frost_only | 6 | | | | | | Basis |
| ab 01.11. | maintain | | | | | | | |

## Zurück

Einstellungen › Haus › Nacht › „Frostschutz“. Das Protokoll läuft in beiden Modi weiter.
