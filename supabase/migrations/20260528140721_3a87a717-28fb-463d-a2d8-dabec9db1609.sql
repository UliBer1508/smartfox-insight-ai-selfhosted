UPDATE public.ai_parameter_whitelist
SET enabled = false,
    autonomy_level = 'shadow',
    notes = COALESCE(notes, '') || ' [auto-disabled: konsolidiert in KI Batterie-Empfehlung]',
    updated_at = now()
WHERE parameter_key IN (
  'heating_min_battery_soc',
  'battery_reserve_for_night_soc',
  'micro_budget_min_battery_soc'
);