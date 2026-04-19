

## Plan-Anpassung: Batterie-Reserve für Nachverbrauch

### Deine Anforderung verstanden

Die Batterie darf **nicht** beliebig für Heizung verwendet werden — sie muss eine Reserve für den **Abend-/Nachtverbrauch** behalten. Konkret:
- **Mindest-SOC nach Heiz-Tag**: ~60% (anpassbar)
- **Validierung**: Prüfen, wie viel Batterie morgens um 09:00 (Heizstart) noch vorhanden ist → daraus lernen, wie aggressiv geheizt werden darf

### Ergänzungen zum bisherigen Plan

**1. Neue Settings (statt nur Batterie-Puffer)**

```sql
ALTER TABLE heating_settings 
  ADD COLUMN battery_reserve_for_night_soc integer DEFAULT 60,  -- Mindest-SOC, der für Nachverbrauch reserviert bleibt
  ADD COLUMN battery_buffer_enabled boolean DEFAULT true,
  ADD COLUMN battery_buffer_bonus_w integer DEFAULT 500,
  ADD COLUMN tolerant_deactivation_enabled boolean DEFAULT true;
```

→ `battery_buffer_min_soc` entfällt, ersetzt durch `battery_reserve_for_night_soc` (ist semantisch klarer).

**2. Neue Tabelle für Tages-SOC-Tracking**

```sql
CREATE TABLE battery_daily_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  soc_at_heating_start numeric,      -- SOC um 09:00 (Heizstart)
  soc_at_heating_end numeric,        -- SOC um Sonnenuntergang/Heizende
  soc_at_morning numeric,            -- SOC am nächsten Morgen 09:00
  min_soc_during_night numeric,      -- tiefster SOC während Nacht
  night_consumption_kwh numeric,     -- echter Nachverbrauch aus Batterie
  heating_battery_used_kwh numeric,  -- für Heizung verwendete Batterie
  created_at timestamp with time zone DEFAULT now()
);
```

→ Erlaubt Lern-Effekt: System sieht, ob 60% Reserve tatsächlich gereicht hat.

**3. Logik in `pv-automation/index.ts`**

**A. Dynamischer Mindest-SOC** ersetzt statischen Wert:

```ts
const batteryReserveSoc = settings.battery_reserve_for_night_soc; // default 60

// Batterie-Puffer nur wenn SOC weit genug über Reserve
const socAboveReserve = batterySoc - batteryReserveSoc;

let batteryBuffer = 0;
if (settings.battery_buffer_enabled 
    && socAboveReserve > 20  // mind. 20% Puffer ÜBER der Reserve (also SOC > 80% bei Reserve=60)
    && remainingPvForHeatingWh >= totalDailyHeatingNeedWh
    && pvTrend >= -300) {
  // Bonus skaliert mit Abstand zur Reserve
  if (socAboveReserve >= 35) batteryBuffer = settings.battery_buffer_bonus_w;        // SOC ≥95%
  else if (socAboveReserve >= 25) batteryBuffer = settings.battery_buffer_bonus_w * 0.6; // SOC ≥85%
  else batteryBuffer = settings.battery_buffer_bonus_w * 0.3; // SOC 80-85%
}
```

**B. Mikro-Budget bekommt ebenfalls dynamische Untergrenze**

```ts
// statt micro_budget_min_battery_soc (default 80) prüfen wir jetzt:
const microMinSoc = Math.max(
  settings.micro_budget_min_battery_soc,
  settings.battery_reserve_for_night_soc + 20  // mind. 20% über Reserve
);
```

→ Bei Reserve=60% ist Mikro-Modus erst ab SOC≥80% aktiv (wie bisher).
→ Bei Reserve=70% ist Mikro-Modus erst ab SOC≥90% aktiv (strenger).

**C. SOC-Tracking täglich erfassen**

In `pv-automation` zwei Snapshot-Punkte einbauen:
- Bei erstem Run nach 09:00 → `soc_at_heating_start` upserten
- Bei letztem Run vor Sonnenuntergang → `soc_at_heating_end` upserten

**4. Neuer Edge-Function Job: Tages-Validierung**

`validate-battery-reserve` (täglich um 09:05 Uhr via pg_cron):
- Berechnet `night_consumption_kwh` aus `energy_readings` (gestern 20:00 → heute 09:00)
- Vergleicht `soc_at_heating_end` mit `soc_at_morning`
- Wenn Reserve **unterschritten** wurde (z.B. soc_at_morning < battery_reserve_for_night_soc-10): logged Warnung, optional → schlägt Erhöhung der Reserve vor
- Schreibt in `system_settings.battery_reserve_validation` ein Status-Objekt:
  ```json
  { "last_check": "2026-04-19T09:05:00Z", 
    "reserve_held": true, 
    "actual_morning_soc": 64, 
    "target_reserve": 60,
    "suggestion": "ok" }
  ```

**5. Frontend `HeatingSettingsForm.tsx`**

Neue Card **"Batterie-Reserve für Nachverbrauch"**:
- Slider: Mindest-SOC nach Heiz-Tag (40-80%, default 60%)
- Switch: Batterie-Puffer für Heizung aktivieren
- Slider: Max. Bonus-Leistung (200-1500W)
- Info-Anzeige: „Letzter Morgen-SOC: 64% (Reserve: 60% ✅ gehalten)"
- Switch: Tolerante Deaktivierung

**6. Frontend: Neues Mini-Widget im Heating Dashboard**

`BatteryReserveStatus.tsx`:
- Zeigt aktuellen SOC, Reserve-Linie, Puffer-Bereich
- Letzter Morgen-SOC + Validierungs-Status (✅/⚠️)
- Letzter Nacht-Verbrauch in kWh

**7. Memory-Update**

`mem://arch/pv-automation-budget-logic-v2` erweitern um:
- Battery-Reserve-Konzept (`battery_reserve_for_night_soc`)
- Skalierter Puffer-Bonus (3 Stufen je nach Abstand zur Reserve)
- Tägliche Validierung via `battery_daily_tracking`

### Erwartetes Verhalten

**Beispiel: Reserve=60%, aktueller SOC=91%, Prognose-Rest=52 kWh**
- `socAboveReserve` = 31 → Tier 2 → +300W Puffer
- + Prognose-Bonus +1500W + Trend 0W = **Eco-Budget = 1808W + Live-Export**
- 3 Räume parallel auf Eco

**Validierungs-Loop:**
- 09:00 Tag 1: SOC=85% gespeichert
- 17:00 Tag 1: SOC=68% gespeichert (heizung hat 17% verbraucht)
- 09:00 Tag 2: SOC=58% → Reserve unterschritten ⚠️
- System zeigt Warnung: „Reserve 60% wurde knapp verfehlt — erwäge Reserve auf 65% zu erhöhen"

### Trade-offs

- **Konservativ**: Bei Reserve=60% wird seltener aus Batterie geheizt → mehr Räume bleiben kühler bei wenig PV
- **Lernfähig**: Validierung zeigt empirisch, ob 60% reicht — User kann Wert anpassen
- **Sicher**: Mikro-Modus + Puffer haben harten Cutoff bei `battery_reserve_for_night_soc + 20%` → kein Drain unter Reserve möglich

