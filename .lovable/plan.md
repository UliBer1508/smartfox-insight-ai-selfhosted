## Schritt 1: DB-Migration für Mode-Befehle

Fügt der Tabelle `thermostat_commands` eine Text-Spalte hinzu, damit nicht-numerische Befehlswerte (z.B. `manual`, `auto`) gespeichert werden können.

### Migration

```sql
ALTER TABLE public.thermostat_commands
ADD COLUMN value_text text;

COMMENT ON COLUMN public.thermostat_commands.value_text IS
  'String-Wert für nicht-numerische Befehle wie set_mode (manual/auto). Bei numerischen Befehlen (set_temperature) wird weiterhin value verwendet.';
```

### Auswirkungen

- **Bestehende Daten**: Keine Änderung. Spalte ist nullable, alle alten Zeilen bleiben gültig.
- **Bestehende Befehle** (`set_temperature`, etc.): Lesen weiter `value` (numeric) — keine Code-Änderung nötig.
- **Neue Befehle** (`set_mode`): Schreiben `value_text = 'manual'`/`'auto'`, `value` bleibt NULL.
- **RLS**: Unverändert, neue Spalte fällt unter bestehende Policies.

### Nächste Schritte (NICHT Teil dieser Migration)

- **Schritt 2** (manuell durch dich am externen Node-Service): `index.js` `set_mode` Handler liest `cmd.value_text` statt `cmd.value`.
- **Schritt 3** (Folge-Plan): `pv-automation` Edge Function schreibt `set_mode=manual` Command beim Nacht-Übergang und vor jedem Setpoint-Write, wenn der zuletzt bekannte Modus ≠ `manual`.