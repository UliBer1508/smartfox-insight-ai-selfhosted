

# Analyse: Warum wird seit 6 Uhr geheizt?

## Befund

Die Heizung läuft korrekt im **Nachtmodus** (20:00–09:00). Es werden KEINE Räume auf Komfort- oder Eco-Temperatur geheizt. Was passiert:

- **Wirtschaftsraum**: Ist 17.7°C, Nacht-Ziel 18°C → Thermostat heizt autonom (+0.3°C)
- **Zimmer Luis**: Ist 18.1°C, Nacht-Ziel 18.5°C → Thermostat heizt autonom (+0.4°C)

Die TGP508-Thermostate heizen **intern automatisch** wenn `Ist < Soll`. Das System setzt während der Nacht nur die Zieltemperatur auf `night_temp` — es kann nicht verhindern, dass der Thermostat zum Halten dieser Temperatur Strom verbraucht.

**Das ist normales Nacht-Cycling**, kein Bug. Aber es verbraucht unnötig Strom aus dem Netz.

## Problem

Aktuelles Verhalten: Nachtmodus hält `night_temp` (17–19°C je Raum) → Thermostate cyclen die ganze Nacht um diese Temperatur zu halten → Netzverbrauch.

Gewünschtes Verhalten: Vor 09:00 soll **kein** aktives Heizen stattfinden.

## Lösung: Nacht-Absenkung auf Frostschutz

In `supabase/functions/pv-automation/index.ts` die Nacht-Logik erweitern:

1. **Neues Setting `night_heating_mode`** mit zwei Optionen:
   - `maintain` (aktuell): Thermostate halten `night_temp` → Cycling erlaubt
   - `frost_only` (neu): Thermostate auf Frostschutz-Temperatur (z.B. 5°C) → kein Heizen

2. **Alternative (einfacher, ohne neues Setting):** Die Nacht-Zieltemperatur um z.B. 2°C absenken, sodass die Thermostate seltener cyclen. Aber das verhindert Heizen nicht komplett.

3. **Empfohlene Lösung:** Thermostate während der Nacht **ausschalten** (`switch: false` via Tuya API) und erst um 09:00 wieder einschalten. Das spart am meisten Strom, erfordert aber eine "Aufwärm-Phase" ab 09:00.

### Vorgeschlagene Implementierung

**Datei: `supabase/functions/pv-automation/index.ts`** — Nachtmodus-Abschnitt (Zeile 358–463):

- Statt `night_temp` zu setzen, Thermostat komplett ausschalten (`switch: false`)
- Beim Verlassen des Nachtmodus (09:00): Thermostat einschalten und auf `eco_temp` setzen
- Neues DB-Feld `night_heating_mode` in `heating_settings` (optional, Fallback: `frost_only`)

**Datei: `supabase/functions/tuya-control/index.ts`**:
- Neue Aktion `switch_off` / `switch_on` für den Thermostat-Schalter

### Ergebnis
- Vor 09:00: Thermostate aus → 0W Heizverbrauch
- Ab 09:00: Thermostate ein → Aufheizen auf eco_temp beginnt
- Risiko: Räume können bei sehr kalten Nächten stärker auskühlen

