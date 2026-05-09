## Schritt 3: Mode-Guard in `pv-automation`

Verhindert, dass Tuya-Thermostate im Modus `auto`/`temporary`/`away` hängen bleiben und ihre internen Schedules unsere Setpoints überschreiben. Lösung: Vor jedem Setpoint-Write proaktiv `set_mode=manual` einreihen (deduped).

### Änderung: `queueLocalTemperatureCommand` (ab Zeile 415)

Vor dem `set_temp` INSERT zusätzlich einen `set_mode=manual` Command einreihen — aber nur, wenn nicht bereits ein pending `set_mode`-Befehl für diesen Raum existiert.

```typescript
// NEU: Mode-Guard — sicherstellen dass Thermostat im manual-Modus ist
const { data: pendingMode } = await supabase
  .from('thermostat_commands')
  .select('id')
  .eq('room_id', roomId)
  .eq('command', 'set_mode')
  .eq('status', 'pending')
  .limit(1)
  .maybeSingle();

if (!pendingMode?.id) {
  await supabase.from('thermostat_commands').insert({
    room_id: roomId,
    command: 'set_mode',
    value_text: 'manual',
    status: 'pending',
  });
}

// Bestehender set_temp INSERT (unverändert)
const { error } = await supabase.from('thermostat_commands').insert({
  room_id: roomId,
  command: 'set_temp',
  value: temperature,
  status: 'pending',
});
```

Den irreführenden Kommentar in Zeile 434 entfernen (v2-Service setzt Mode **nicht** atomar).

### Auswirkungen

- **Pro Setpoint-Wechsel:** maximal 1 zusätzlicher `set_mode`-Command. Dedup via Pending-Check verhindert Spam.
- **Bei stabilem `manual`-Modus:** der Service führt den Befehl trotzdem aus (idempotent) — minimaler Overhead (~70ms pro Raum).
- **Cloud-Modus** (Zeile 450+): nicht betroffen, dort läuft Tuya-API direkt.
- **Nacht-Übergang:** automatisch abgedeckt, da pv-automation beim Nacht-Setpoint sowieso `queueLocalTemperatureCommand` aufruft.

### Voraussetzung (bereits erledigt)

✅ DB-Spalte `value_text` (Schritt 1)
✅ Lokaler Service liest `cmd.value_text ?? cmd.value` für `set_mode` (Schritt 2)

### Nicht Teil dieses Plans

- Kein neues DB-Feld für "letzter bekannter Modus" — Dedup via Pending-Check reicht.
- Keine Cloud-API-Änderung — bei Cloud-Pfad steuert Tuya selbst und Schedules sind dort kein Problem.