## Ziel

Eine einzige KI-Parameter-UI (`AIShadowDecisions`) mit Whitelist-Validierung, Outcome-Tracking und optionalem Apply-Button. `AISettingsSuggestions` und die zugehörige Edge-Function werden entfernt — keine Doppel-Quota, keine Bypass-Apply-Pfade mehr.

## Änderungen

### 1. Entfernen

- `src/components/heating/AISettingsSuggestions.tsx`
- `src/hooks/useSettingsSuggestions.ts`
- `supabase/functions/generate-settings-suggestions/` (inkl. Deploy-Cleanup)
- Einbindung der Karte aus dem HeatingDashboard / Settings (dort wo sie gerendert wird)

### 2. `AIShadowDecisions` erweitern (`src/components/heating/AIShadowDecisions.tsx`)

- Whitelist (`ai_parameter_whitelist`) zusätzlich laden, indexiert nach `parameter_key`
- Pro Decision-Zeile prüfen: passender Whitelist-Eintrag und `autonomy_level`
  - `shadow` → kein Apply-Button (heutiges Verhalten)
  - `suggest` → Button **„Übernehmen"** sichtbar
  - `auto` → Badge **„Auto"**, kein Button (Zukunft, hier nur sichtbar)
- Apply-Aktion: schreibt `proposed_value` in `whitelist.storage_table`/`storage_column`
  - Bei `scope='room'`: `UPDATE rooms SET <col> = <val> WHERE id = decision.room_id`
  - Bei `scope='global'`: `UPDATE heating_settings SET <col> = <val>` (single row)
  - Vor dem Schreiben Range/`allowed_values`-Check (defensive Doppel-Validierung)
  - Nach Erfolg `ai_parameter_decisions.applied_at = now()`, `applied_by = 'user'` setzen
- Spalte „Status" in der Tabelle: `Offen` / `Übernommen am …` / `Verworfen` / `Outcome ±x`
- Toast bei Erfolg/Fehler

### 3. Autonomie-Steuerung in der UI (klein)

- Im erweiterten Bereich (Expand-Row) ein Select `Autonomy: shadow / suggest / auto`, der den Whitelist-Eintrag des Parameters umstellt (Update auf `ai_parameter_whitelist` per parameter_key + scope)
- Damit kann der User einzelne Parameter aus dem Schatten in den „Suggest"-Modus heben, ohne die DB direkt zu editieren

### 4. Memory-Update

- `mem://features/heating/ai-shadow-decisions` ergänzen: Apply-Pfad implementiert, Trigger via `autonomy_level`
- Alte Memory `mem://features/heating/ai-settings-suggestions-hardened` als deprecated markieren bzw. löschen
- Index aktualisieren

## Technische Details

**Apply-Logik (vereinfacht):**

```ts
const wl = whitelistByKey[d.parameter_key];
// Range-Check
const num = Number(d.proposed_value);
if (wl.data_type === 'number') {
  if (wl.min_value != null && num < wl.min_value) reject();
  if (wl.max_value != null && num > wl.max_value) reject();
} else if (wl.allowed_values && !wl.allowed_values.includes(d.proposed_value)) reject();

// Write
const value = wl.data_type === 'number' ? num
            : wl.data_type === 'boolean' ? d.proposed_value === 'true'
            : d.proposed_value;

if (wl.scope === 'room') {
  await supabase.from('rooms').update({ [wl.storage_column]: value }).eq('id', d.room_id);
} else {
  const { data: s } = await supabase.from('heating_settings').select('id').limit(1).single();
  await supabase.from('heating_settings').update({ [wl.storage_column]: value }).eq('id', s.id);
}
await supabase.from('ai_parameter_decisions').update({ applied_at: new Date().toISOString(), applied_by: 'user' }).eq('id', d.id);
```

**Edge-Function-Cleanup:** `supabase--delete_edge_functions(['generate-settings-suggestions'])` nach dem Code-Delete.

**Quota-Effekt:** Nur noch `ai-parameter-advisor` (alle 15 min) ruft Gemini → halbierte Last, Rate-Limit-Problem entschärft.

## Was nicht geändert wird

- `ai-parameter-advisor`, `ai-parameter-evaluator`, `ai_parameter_whitelist`-Schema bleiben unverändert
- Schreibpfade in `heating_settings`/`rooms` selbst bleiben gleich
- Kein Auto-Apply in dieser Iteration (nur „suggest" mit Button)
