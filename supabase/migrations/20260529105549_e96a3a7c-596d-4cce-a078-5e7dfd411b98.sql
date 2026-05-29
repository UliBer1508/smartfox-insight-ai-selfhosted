UPDATE public.ai_parameter_whitelist
SET min_value = 200
WHERE parameter_key = 'pv_surplus_threshold_on'
  AND storage_table = 'heating_settings';