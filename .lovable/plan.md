
# Sequenzielles Heizen mit Leistungsbudget-Management

## Problemstellung

Aktuell heizen bis zu 5 Raeume gleichzeitig (5.2+ kW), was bei nur 1.3 kW PV-Produktion zu 5.5 kW Netzbezug fuehrt. Auch nachts/bei Bewoelkung ist simultanes Heizen suboptimal.

## Loesung: Intelligentes Leistungsbudget

### Zwei Modi

**Modus 1: PV-Optimiert (Tag mit Sonne)**
- Budget = PV-Leistung - Grundlast + Toleranz
- Ziel: Minimaler Netzbezug

**Modus 2: Netz-Sequenziell (Nacht / keine PV)**
- Budget = Konfiguriertes Maximum (z.B. 2000W)
- Ziel: Spitzenlast begrenzen, aber Komfort erhalten

### Entscheidungslogik

```text
WENN pv_power > 500W:
  -> PV-Optimierter Modus
  -> Budget = pv_power - grundlast + toleranz
SONST:
  -> Netz-Sequenziell Modus  
  -> Budget = max_grid_heating_power (z.B. 2000W)
  -> Erlaubt 2-3 Raeume gleichzeitig statt alle 9
```

---

## Technische Umsetzung

### Datenbank-Aenderungen

**heating_settings - Neue Spalten:**

| Spalte | Typ | Default | Beschreibung |
|--------|-----|---------|--------------|
| power_budget_enabled | boolean | true | Aktiviert Leistungsbudget-Management |
| max_grid_heating_power_w | integer | 2000 | Max. Heizleistung bei Netzbezug |
| power_budget_tolerance_w | integer | 200 | Erlaubte Ueberschreitung |
| room_rotation_minutes | integer | 30 | Heizzeit pro Raum vor Rotation |
| min_room_pause_minutes | integer | 15 | Mindest-Pause nach Rotation |

**rooms - Neue Spalten:**

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| last_heating_start | timestamptz | Wann aktuelle Heizphase begann |
| last_heating_end | timestamptz | Wann letzte Heizphase endete |
| heating_paused_reason | text | Grund fuer Pause (budget/rotation/target_reached) |

---

### Algorithmus in pv-automation

```text
1. BUDGET BERECHNEN
   ─────────────────
   Wenn pv_power > 500W:
     modus = "pv_optimized"
     budget = pv_power - base_load + tolerance
   Sonst:
     modus = "grid_sequential"
     budget = max_grid_heating_power

2. RAEUME SORTIEREN
   ─────────────────
   Sortierung nach:
   a) Prioritaet (1 = hoch, 3 = niedrig)
   b) Temperatur-Defizit (kältester zuerst)
   c) Wartezeit seit letzter Heizung (laengste zuerst)

3. ROTATION PRUEFEN
   ─────────────────
   Fuer jeden aktiv heizenden Raum:
     Wenn heiz_dauer > rotation_minutes UND andere warten:
       -> Pausieren, Grund = "rotation"
       -> Budget wird frei

4. AKTIVIERUNG PRUEFEN
   ─────────────────────
   Fuer jeden pausierten/wartenden Raum:
     Wenn pause_dauer > min_pause_minutes:
       Wenn raum.heating_power <= verfuegbares_budget:
         -> Aktivieren
         -> budget -= raum.heating_power
       Sonst:
         -> Weiter warten, Grund = "budget"

5. LOGGING
   ────────
   Zeige: Modus, Budget, Aktive Raeume, Wartende Raeume
```

---

### Beispiel-Szenarien

**Szenario 1: Tag mit 1.3 kW PV**
```
Modus: pv_optimized
Budget: 1300W - 400W (Grundlast) + 200W = 1100W

10:00 - Buero (900W) aktiviert, Budget: 200W verbleibend
10:30 - Buero warm, pausiert -> Bad Uli (600W) aktiviert
11:00 - PV steigt auf 2.5kW -> Budget 2300W
       -> Buero + Wohnzimmer gleichzeitig moeglich
```

**Szenario 2: Nacht ohne PV**
```
Modus: grid_sequential
Budget: 2000W (konfiguriert)

22:00 - Buero (900W) + Bad Uli (600W) = 1500W aktiv
22:30 - Buero warm, pausiert -> Wirtschaftsraum (700W) startet
23:00 - Rotation: Bad Uli pausiert -> Wohnzimmer (2400W) 
        -> Passt nicht! -> Bad Uli weitermachen
```

**Szenario 3: Frostschutz-Nacht**
```
Modus: grid_sequential (reduziert)
Budget: 1000W (Nachtmodus)

Alle Raeume auf Frostschutz-Temp (16°C)
Nur Raum heizt, der unter 14°C faellt
-> Minimal-Verbrauch, Rotation nur bei Bedarf
```

---

## Dateien die geaendert werden

| Datei | Aenderung |
|-------|-----------|
| `supabase/migrations/` | Neue Spalten fuer heating_settings und rooms |
| `supabase/functions/pv-automation/index.ts` | Leistungsbudget-Algorithmus |
| `src/types/heating.ts` | Neue TypeScript-Typen |
| `src/hooks/useHeatingSettings.ts` | Default-Werte erweitern |
| `src/components/heating/HeatingSettingsForm.tsx` | UI fuer neue Einstellungen |

---

## UI-Erweiterung (optional)

Neuer Abschnitt in Einstellungen:

```
┌─────────────────────────────────────────────────┐
│ Leistungsbudget-Management                      │
├─────────────────────────────────────────────────┤
│ [x] Aktiviert                                   │
│                                                 │
│ Max. Heizleistung bei Netzbezug: [2000] W       │
│ (Wie viele Räume gleichzeitig bei Nacht/Wolken) │
│                                                 │
│ Rotationszeit pro Raum: [30] Minuten            │
│ Mindest-Pause nach Rotation: [15] Minuten       │
│                                                 │
│ Toleranz für PV-Modus: [200] W                  │
│ (Erlaubter Netzbezug im PV-Modus)               │
└─────────────────────────────────────────────────┘
```

---

## Erwartete Ergebnisse

| Situation | Vorher | Nachher |
|-----------|--------|---------|
| Tag, 1.3kW PV | 5.5kW Netzbezug | ~0W Netzbezug |
| Nacht, alle heizen | 5.2kW Spitze | 2kW Maximum |
| Bewoelkt, kein PV | Unkontrolliert | 2kW gedeckelt |

**Jaehrliche Ersparnis geschaetzt:**
- Weniger Netzspitzen = guenstigerer Tarif
- Bessere PV-Eigennutzung = weniger Einspeisung zu 8ct
- Gleichmaessigere Waerme = weniger Zyklen = laengere Thermostat-Lebensdauer
