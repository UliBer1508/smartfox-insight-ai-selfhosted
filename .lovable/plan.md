## Problem

Clicking "Übernehmen – Gate auf 75 %" fails with:
`Edge function returned 500: ... "Time value 20:00:00 for night_start_time below whitelist min (minutes since 00:00): 1260"`

The `battery-soc-decision` edge function only writes `heating_min_battery_soc` and `battery_reserve_for_night_soc`. But the database trigger `validate_ai_auto_apply` runs on **every** update of `heating_settings` and re-validates **all** whitelisted auto parameters against the new row — including columns that were not changed.

Currently stored vs. whitelist range:
- `night_start_time` = 20:00 (1200 min), whitelist min = 1260 (21:00) → blocks the update
- `pv_surplus_threshold_on` = 200 (already aligned in a previous fix)

Because an unrelated, unchanged column (`night_start_time`) is outside its whitelist range, the whole update is rejected.

## Fix

Update the `validate_ai_auto_apply` trigger function so it only validates a parameter when its value is actually being changed by this update. For each whitelisted auto parameter:

- On `INSERT`: validate as today (no previous value exists).
- On `UPDATE`: skip the check when the new value equals the old value (`NEW.<col> IS NOT DISTINCT FROM OLD.<col>`), i.e. the column is unchanged. Only validate columns the caller is actually modifying.

This keeps the safety guard intact for any value the AI/automation truly tries to write, while letting legitimate partial updates (like the battery-gate accept) pass through.

## Technical details

- Single migration that does `CREATE OR REPLACE FUNCTION public.validate_ai_auto_apply()`.
- Keep all existing logic (kill-switch check, role check, time-vs-minutes conversion, numeric min/max, allowed_values).
- Inside the whitelist loop, compare the per-parameter value in `NEW` vs `OLD`:
  - Use `to_jsonb(NEW) ->> wl.parameter_key` and `to_jsonb(OLD) ->> wl.parameter_key`.
  - On `TG_OP = 'UPDATE'`, if both are equal (or both null), `CONTINUE` before running any range/allowed-values checks.
- No table/column/RLS changes; no edge-function or frontend changes required.

## Verification

- After the migration, call `battery-soc-decision` with the pending suggestion (accept) and confirm it returns success and updates `heating_min_battery_soc`/`battery_reserve_for_night_soc`.
- Confirm a deliberately out-of-range change to a whitelisted column (e.g. setting `night_start_time` to 20:00 while it is the changed column) is still rejected, proving the guard still works.