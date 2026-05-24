## Batterie-Einstellungen entdoppeln + Slider-Bug fixen

### Befund: Zwei überlappende Werte

In `HeatingSettingsForm.tsx` (Block „Batterie-Reserve für Nachverbrauch") existieren **zwei** SOC-Schwellen, die de facto denselben Zweck erfüllen (Batterie für Abend/Nacht schonen), sich aber widersprechen können:

| Feld | UI-Label | Default | Verwendung |
|---|---|---|---|
| `battery_reserve_for_night_soc` | „Mindest-SOC nach Heiz-Tag" | 60 % | Referenz für Puffer-Logik (`Reserve+20`, `Reserve+35`), Validate-Reserve-Edge-Function |
| `heating_min_battery_soc` | „Heizung-Schutz: Mindest-SOC für Batterienutzung" | 80 % | Hartes SOC-Gate (`strict`/`soft`), blockiert Entladung der Heizung |

Im aktuellen Screenshot: Reserve = 70 %, Gate = 80 % → Puffer-Logik rechnet mit `Reserve+20 = 90 %`, das Gate blockt aber schon bei 80 %. Inkonsistent + verwirrend.

### Befund: Slider lassen sich nicht bedienen

Die drei betroffenen Regler („Mindest-SOC nach Heiz-Tag", „Max. Puffer-Bonus", „Heizung-Schutz") sind als **native `<Input type="range">`** umgesetzt (Zeilen 274, 308, 343). Die `Input`-Komponente von shadcn legt Padding/Border-Styles über das native Range-Element, wodurch der Drag-Handle nicht zuverlässig anklickbar ist. Alle anderen Slider im Projekt nutzen die Radix-`<Slider>`-Komponente (`@/components/ui/slider`).

### Lösungskonzept

**1. Konsolidierung auf EINEN Wert**

- `heating_min_battery_soc` wird der **einzige** Nacht-Reserve-/Heizungs-Gate-Wert.  
  UI-Label: „**Mindest-SOC für Nacht-Reserve**" (40–95 %, Default 80 %).
- `battery_reserve_for_night_soc` aus der UI entfernen. Im `saveSettings`-Hook wird der Wert beim Speichern automatisch gespiegelt (`battery_reserve_for_night_soc = heating_min_battery_soc`), damit bestehende Edge Functions (`validate-battery-reserve`, `compute-daily-score`, `analyze-patterns`, `ai-daily-planner`, `pv-automation`) ohne Anfassen weiter funktionieren.
- In `pv-automation` ist der Fallback `heating_min_battery_soc ?? battery_reserve_for_night_soc ?? 80` schon vorhanden → keine Edge-Function-Migration nötig.
- Hinweistext anpassen: „Diese Reserve schützt die Batterie für Abend-/Nachtverbrauch und gilt zugleich als hartes SOC-Gate für die Heizung."
- Puffer-Logik-Erklärung beibehalten (`Reserve+20` / `Reserve+35` referenzieren jetzt diesen einen Wert).

**2. Slider-Bug beheben**

Die drei `<Input type="range">` durch die Radix-`<Slider>`-Komponente ersetzen (analog zu anderen Slidern im Projekt). Range/Step bleiben gleich:

- Mindest-SOC: 40–95, Step 5  
- Puffer-Bonus: 200–1500 W, Step 100

### Geänderte Dateien

- `src/components/heating/HeatingSettingsForm.tsx` — Block ab Zeile 261 neu strukturieren: 1 Slider statt 2, alle 3 Regler auf `<Slider>` umstellen, Texte anpassen.
- `src/hooks/useHeatingSettings.ts` — in `saveSettings` Spiegelung `battery_reserve_for_night_soc = heating_min_battery_soc`.
- `src/types/heating.ts` — `battery_reserve_for_night_soc` als `@deprecated` markieren (Feld bleibt für Backwards-Compat).

### Nicht geändert

- Datenbankschema (Spalte `battery_reserve_for_night_soc` bleibt erhalten).
- Edge Functions.
- Puffer-Logik, Tolerante Deaktivierung, Sperr-Modus.

### Verifikation

- Slider in Settings draggbar (Maus + Touch).
- Speichern setzt beide Spalten auf denselben Wert; nach Reload identischer Wert sichtbar.
- `pv-automation`-Logs: `heatingMinSoc` und `batteryReserveSoc` haben denselben Wert.
