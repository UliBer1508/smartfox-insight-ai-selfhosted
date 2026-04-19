
## Plan: Mikro-Budget mit Rotation umsetzen

### Was wird gebaut

**Neuer Modus in `pv-automation/index.ts`** zwischen Phase 1 (Eco) und Phase 2 (Komfort): Wenn `0 < ecoBudget < minRoomPower`, wird **ein** Raum rotierend für 5 Min auf Eco aktiviert — Batterie >80% dient als Puffer.

### Konkrete Änderungen

**1. DB-Migration** — 3 neue Spalten in `heating_settings`:
- `micro_budget_enabled` boolean default true
- `micro_budget_min_battery_soc` int default 80
- `micro_heat_duration_min` int default 5

**2. `supabase/functions/pv-automation/index.ts`**
Neuer Block nach Phase 1, vor Phase 2:

```ts
// MIKRO-BUDGET MODUS
if (settings.micro_budget_enabled && ecoBudget > 0) {
  const candidates = activeRooms.filter(r => 
    !r.is_heating &&
    r.current_temp < r.eco_temp - 0.2 &&
    !r.manual_override_until
  );
  const minRoomPower = Math.min(...candidates.map(r => r.heating_power_w));
  
  if (ecoBudget < minRoomPower && batterySoc >= settings.micro_budget_min_battery_soc) {
    // Globaler Cooldown via system_settings.last_micro_rotation_at
    const lastMicro = await getSetting('last_micro_rotation_at');
    const minutesSince = (Date.now() - new Date(lastMicro).getTime()) / 60000;
    
    if (minutesSince >= settings.room_rotation_minutes) {
      // Wähle Raum: höchste Prio + größtes Defizit + längste Pause
      const picked = candidates.sort((a, b) => {
        const aPause = Date.now() - new Date(a.pv_auto_last_change || 0).getTime();
        const bPause = Date.now() - new Date(b.pv_auto_last_change || 0).getTime();
        const aScore = (12 - a.priority) * 100 + (a.eco_temp - a.current_temp) * 10 + aPause / 60000;
        const bScore = (12 - b.priority) * 100 + (b.eco_temp - b.current_temp) * 10 + bPause / 60000;
        return bScore - aScore;
      })[0];
      
      await activateRoom(picked, picked.eco_temp, 'MICRO-BUDGET');
      await setSetting('last_micro_rotation_at', new Date().toISOString());
      log(`[MICRO-BUDGET] ${picked.name} aktiviert (Budget=${ecoBudget}W < ${picked.heating_power_w}W, SOC=${batterySoc}%)`);
    }
  }
}
```

Bestehende Sicherheitsgates (Hard PV Gate <500W, Nacht 20-09 Uhr, Manual Override) bleiben **vor** diesem Block aktiv und blockieren bei Bedarf.

**3. `src/components/heating/HeatingSettingsForm.tsx`**
Neue Card "Mikro-Budget Modus" mit:
- Switch: Mikro-Budget aktivieren
- Slider: Min. Batterie-SOC (50-100%)
- Slider: Heizdauer pro Zyklus (3-15 Min)

**4. `src/types/heating.ts` + `useHeatingSettings.ts`**
3 neue Felder + Defaults ergänzen.

**5. Memory-Update**
`mem://arch/pv-automation-budget-logic-v2` um Mikro-Budget-Logik erweitern.

### Erwartetes Verhalten

Bei deinem 10:42-Szenario (Export 8W, Batt 91%):
- Phase 1 scheitert (Budget 208W < 500W kleinster Raum)
- **Mikro-Modus aktiviert** → Bad Uli (P1) heizt 5 Min
- 30 Min später → Zimmer Uli (P2)
- Räume erreichen rotierend Eco-Temp
- Bei SOC <80% pausiert Mikro-Modus automatisch

### Risiken / Limits
- Tuya-Quota: max 24 zusätzliche Calls/Stunde (bei 200/Tag OK)
- Batterie-Drain: ~100 Wh pro Zyklus (unkritisch bei 13.8 kWh)
