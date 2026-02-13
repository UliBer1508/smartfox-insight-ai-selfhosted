

# Batterie-Schutz und PV-gesteuertes sequenzielles Heizen

## Problem JETZT

| Wert | Status |
|------|--------|
| Batterie | 5.1% SOC - praktisch leer |
| PV | 75W - noch kein nennenswerter Ertrag |
| Verbrauch | 2.358W - davon ~1.500W Heizung |
| Heizende Raeume | 4 von 10 (Buero, Wirtschaftsraum, Wohnzimmer, Zimmer Luis) |
| Alle target_temp | 18 Grad (Nachtmodus) |

Die Thermostate heizen autonom auf 18 Grad weil die Budget-Logik (`!isNight`) nachts deaktiviert ist.

## Ursache

Zeile 1117 in `pv-automation/index.ts`:

```text
if (powerBudgetEnabled && !isNight) {
    // Budget-Logik nur tagsueber aktiv
}
```

Nachts gibt es KEINEN Mechanismus der das Heizen stoppt wenn die Batterie leer ist.

## Loesung: Batterie-Schutz in den Nachtmodus integrieren

### Aenderung 1: Nachtmodus mit Batterie-Check (Zeilen 915-928)

```text
VORHER:
  Nacht → target_temp = night_temp (18 Grad) — immer

NACHHER:
  Nacht + Batterie >= 30% → target_temp = night_temp (18 Grad)
  Nacht + Batterie < 30%  → target_temp = 15 Grad (Heizung stoppt)
```

Die Thermostate werden auf 15 Grad gesetzt — da alle Raeume ueber 17 Grad sind, stoppt das Heizen sofort.

### Aenderung 2: Budget-Logik auch nachts bei leerem Akku (Zeile 1117)

```text
VORHER:
  if (powerBudgetEnabled && !isNight) { ... }

NACHHER:
  if (powerBudgetEnabled && (!isNight || batterySoc < 30)) { ... }
```

Bei leerem Akku greift die Budget-Logik auch nachts und setzt nicht-erlaubte Raeume auf 15 Grad.

### Aenderung 3: Uebergang Nacht → Tag verbessern

Sobald die Nacht endet (09:00) und PV verfuegbar ist, uebernimmt die bestehende sequenzielle Heizlogik:
- Budget wird aus verfuegbarer PV berechnet
- Raeume werden nach Prioritaet und Temperatur-Defizit sortiert
- Ein Raum heizt 30 Minuten, dann Rotation

Hier ist keine Aenderung noetig — die bestehende Logik funktioniert bereits korrekt.

## Dateiänderungen

| Datei | Stelle | Aenderung |
|-------|--------|-----------|
| `supabase/functions/pv-automation/index.ts` | Zeilen 915-928 | Nachtmodus: Batterie-Check einbauen, 15 Grad bei SOC < 30% |
| `supabase/functions/pv-automation/index.ts` | Zeile 1117 | Budget-Logik: Auch nachts bei leerem Akku aktiv |

## Erwarteter Effekt

### Sofort nach Deploy:
```text
Alle 10 Raeume → 15 Grad (Batterie 5.1% < 30%)
Heizung stoppt komplett
Verbrauch sinkt von 2.358W auf ~400W Grundlast
Batterie haelt laenger
```

### Ab ca. 09:00-10:00 (PV steigt):
```text
Nacht endet → Budget-Logik uebernimmt
PV 500W+ → Budget berechnet → Raum 1 heizt auf Komfort (21 Grad)
Nach 30 Min → Rotation → Raum 2 heizt
Sequenzielles Heizen mit PV-Strom
```

### Naechste Nacht mit voller Batterie (SOC > 30%):
```text
Normaler Nachtmodus → 18 Grad
Batterie hat genuegend Kapazitaet
```

## Risiko

| Risiko | Bewertung |
|--------|-----------|
| Raeume kuehlen auf 16-17 Grad | Akzeptabel — Fussbodenheizung kuehlt langsam, PV startet in 1-2h |
| 15 Grad Thermostat-Ziel | Kein Frostrisiko — Raeume sind aktuell 17-19 Grad |
| SOC-Schwelle 30% | Konservativ — bei 13.8 kWh Batterie sind 30% = 4.14 kWh, genug fuer ~2h Grundlast |

