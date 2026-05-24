## Slider-Fix + Konsolidierung "Mikro-Budget SOC" vs. "Nacht-Reserve SOC"

### Befund 1 — Slider funktionieren nicht

Beide Radix-Slider (`Mindest-SOC für Nacht-Reserve`, `Max. Puffer-Bonus`) sitzen in `HeatingSettingsForm.tsx` innerhalb eines `<form onSubmit={handleSubmit}>`. Der identisch aufgebaute Slider in `PatternRecallBlock.tsx` funktioniert. Der einzige relevante Unterschied: hier ist ein `id`-Attribut auf der `<Slider>`-Wurzel und das `<Label htmlFor="...">` zielt darauf. Radix rendert die Slider-Wurzel als `<span>` — `htmlFor` greift nicht, aber das Label leitet Pointer-Klicks an die Wurzel statt an den Thumb, was bei manchen Browsern den Drag-Start kapern kann. Zusätzlich kann `<form>` bei Tap auf den Slider unbeabsichtigt ein Submit triggern, weil Radix `event.preventDefault()` nicht für alle Event-Pfade aufruft.

### Befund 2 — Doppelte SOC-Schwellen

Zwei Settings adressieren faktisch dasselbe Ziel „Batterie für Abend schonen":

| Setting | Default | Wirkung |
|---|---|---|
| `heating_min_battery_soc` (neuer Slider) | 80 % | **Hartes Gate**: Heizung darf Batterie nur entladen, wenn SOC darüber liegt. Auch Referenz für Puffer-Logik (`Reserve+20/+35`). |
| `micro_budget_min_battery_soc` (Input im Mikro-Budget-Block) | 80 % | Floor speziell für Mikro-Budget-Modus. Im Code: `microMinSoc = max(microMinSocBase, batteryReserveSoc+20, heatingMinSoc)` → der eingestellte Wert wird **fast immer überstimmt** vom Heating-Gate +20. |

→ Der Mikro-SOC-Slider tut in der Praxis selten etwas Sichtbares und verwirrt: zwei Regler, die beide „Min SOC für Nachtreserve" zu sein scheinen, in unterschiedlichen UI-Sektionen.

### Lösung

**A. Slider-Bug beheben** in `src/components/heating/HeatingSettingsForm.tsx`:
- `id`-Attribut von beiden `<Slider>` entfernen; `<Label>` ohne `htmlFor` belassen (rein dekorativ, Wert steht im Label-Text).
- `onKeyDown` am `<form>` ergänzen: Enter-Taste verschluckt, wenn das Target kein Submit-Button ist, um ungewollte Saves beim Tab/Slider zu vermeiden.
- Optional: `className="touch-none"` am Slider-Root (in `src/components/ui/slider.tsx` schon vorhanden via `touch-none`) → keine Änderung nötig.

**B. Mikro-Budget-SOC entfernen, single source of truth** in `HeatingSettingsForm.tsx` + `pv-automation/index.ts`:
- UI: Input „Min. Batterie-SOC (%)" im Mikro-Budget-Block streichen. Stattdessen Hinweistext: „Mikro-Budget nutzt automatisch **Mindest-SOC für Nacht-Reserve + 5 %** als Puffer-Floor."
- Edge: `microMinSocBase` wird aus `heating_min_battery_soc + 5` abgeleitet (Fallback 85). Formel bleibt: `microMinSoc = max(heatingMinSoc + 5, batteryReserveSoc + 20)`. → `micro_budget_min_battery_soc` wird ignoriert (DB-Feld bleibt für Backwards-Compat).
- Heizdauer pro Zyklus (`micro_heat_duration_min`) bleibt unverändert.

### Verhältnis der beiden Werte (zur Klarstellung im UI-Hinweis)

```text
Live-Surplus   →  Vollraum?
  ja           →  normale PV-Logik, Gate: heating_min_battery_soc
  nein, klein  →  Mikro-Budget rotiert Räume, Floor: heating_min_battery_soc + 5
                  (zusätzlich Reserve+20 falls battery_reserve_for_night_soc abweicht)
```

Beide laufen nie gleichzeitig gegen einander — Mikro-Budget greift nur, wenn das normale Budget unter Mindest-Raum-Leistung liegt, und nutzt einen **etwas höheren** SOC-Floor, weil es aktiv entlädt.

### Geänderte Dateien

- `src/components/heating/HeatingSettingsForm.tsx` — `id` auf Sliders entfernen, Enter-Submit unterdrücken, Mikro-SOC-Input durch Hinweistext ersetzen.
- `supabase/functions/pv-automation/index.ts` — `microMinSocBase = heatingMinSoc + 5` statt Settings-Lookup.

### Nicht geändert

- DB-Schema, Types, Puffer-Logik (Reserve+20/+35), Heizdauer.

### Verifikation

- Beide Slider lassen sich per Maus & Touch ziehen, Werte werden im Label live aktualisiert und beim Speichern persistiert.
- Mikro-Budget-Block zeigt nur noch „Aktivieren" + „Heizdauer pro Zyklus" + Hinweistext.
- Edge-Log: `microMinSoc` folgt `heating_min_battery_soc + 5`.
