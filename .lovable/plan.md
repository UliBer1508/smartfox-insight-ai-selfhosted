
# One-Shot Heizlogik mit Komfort-Sättigung

Ziel: Drastisch weniger Tuya-Calls (~35-40/Tag statt 200+) durch sequentielle One-Shot-Logik mit Estrich-Speicher-Nutzung.

## Tagesablauf

```
08:00  alle Räume → Eco                               (12 Calls)
Tag    Räume sequentiell → Komfort wenn Budget       (~6 Calls)
Tag    Komfort erreicht → zurück auf Eco-Setpoint    (~6 Calls)
       (Estrich-Speicher hält Wärme)
20:00  alle Räume → Nacht                             (12 Calls)
─────────────────────────────────────────────────────────────
                                                Total: ~36 Calls
```

## Kernregeln

1. **Sticky Eco** — Tagsüber wird kein Raum von Eco zurück auf Nacht gestellt (außer hartem PV-Gate <500W + Prognose <5kWh).
2. **Komfort-Sättigung** — Sobald `current_temp >= comfort_temp`: 1 Call zurück auf Eco-Setpoint, Raum als "komfort-gesättigt" markiert. Estrich gibt Wärme weiter ab; Thermostat heizt erst wieder, wenn current_temp < eco_temp.
3. **Re-Komfort-Sperre** — Komfort-gesättigte Räume werden tagsüber nicht erneut Komfort-Kandidat (außer current_temp < eco_temp - 0.5).
4. **Skip-Call-Garantie** — Wenn `target_temp` bereits ±0.1°C dem Ziel entspricht: kein Tuya-Call. Pre-Sync von 2h auf 6h erhöht.
5. **Reset um 20:00** — Komfort-Sättigung wird beim Nacht-Switch zurückgesetzt.

## Datenbank-Migration

Neue Spalte:
- `rooms.comfort_saturated_at TIMESTAMPTZ NULL` — Zeitpunkt, an dem Raum Komfort erreicht hat und auf Eco zurückgestellt wurde.

## Code-Änderungen

### `supabase/functions/pv-automation/index.ts`

**A) Phase 2 (Komfort-Runde, ~Zeile 2186-2256)**
- Komfort-Kandidaten ausschließen, wenn `comfort_saturated_at` heute gesetzt ist UND `current_temp >= eco_temp - 0.5`.
- Neuer Block: Räume mit `current_temp >= comfort_temp - 0.1` UND `target_temp == comfort_temp` → action `'set_eco_keep_saturation'`: setze `target_temp = eco_temp`, schreibe `comfort_saturated_at = now()`. 1 Call.
- Räume die "komfort-gesättigt" sind und `current_temp >= eco_temp` → reason "Estrich-Speicher aktiv (gesättigt)", **kein** Call.

**B) Sticky Eco (Zeile ~2241-2256, Phase 2 übersprungen + Zeile ~2666 PV-Gate-Deaktivierung)**
- Im "Phase 2 übersprungen"-Zweig: nie auf night_temp zurückfallen (current behavior bereits OK).
- Harter PV-Gate (Zeile ~2664-2672): nur deaktivieren wenn `current_target > eco_temp + 0.5` UND nicht komfort-gesättigt.

**C) Skip-Call-Garantie (vor jedem Tuya-Call)**
- Vor `executeCommand()`: wenn `Math.abs(currentTargetOnDevice - desiredTarget) < 0.1`, Call überspringen, nur `last_thermostat_sync` aktualisieren.
- `PRE_SYNC_INTERVAL_MIN`: von 120 auf 360.

**D) Nacht-Switch (Zeile ~2640-2652)**
- Beim Nacht-Übergang: `comfort_saturated_at = NULL` für alle Räume zurücksetzen.

**E) Cleanup**
- Entferne ML-getriebene Komfort-Hochstufungen, die `comfort_saturated_at` ignorieren würden.

### UI

`src/components/RoomCard.tsx` (oder Equivalent):
- Badge "Estrich-Speicher aktiv" anzeigen wenn `comfort_saturated_at` gesetzt und current_temp >= eco_temp.

### Memory-Updates

- Update `mem://arch/pv-automation-strategy-v2`: Komfort-Sättigung dokumentieren.
- Update `mem://features/heating/eco-target-restoration`: Sättigungs-Reset um 20:00.
- Neuer Eintrag `mem://features/heating/comfort-saturation-estrich-storage`.
- Update `mem://index.md` Core: One-Shot-Logik mit Sättigung.

## Erwartete Auswirkungen

- Tuya-Calls/Tag: 200+ → ~36
- Stromverbrauch: Räume verbrauchen nach Komfort-Erreichung keinen weiteren Strom (Estrich-Speicher).
- Komfort: Boden bleibt 2-4h warm nach Komfort-Erreichung.
- Quota-Sicherheit: Weit unter Tuya-Limit auch bei wechselhaftem Wetter.

## Risiken & Mitigation

- **Raum kühlt unter Eco trotz Sättigung** → Re-Komfort möglich wenn `current_temp < eco_temp - 0.5` (Hysterese).
- **Manueller Eingriff durch Nutzer** → `manual_override_until` weiterhin respektiert, blockiert auch Sättigungs-Logik.
- **Pre-Sync 6h zu lang bei Drift** → Skip-Call-Garantie greift nur bei korrektem target_temp; bei Drift wird trotzdem korrigiert.
