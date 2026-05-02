UPDATE public.system_settings
SET value = jsonb_build_object(
  'night', value->>'night',
  'failures', 0,
  'successes', COALESCE(value->'successes', to_jsonb(0)),
  'pushed_at', value->>'pushed_at',
  'last_attempt_at', '1970-01-01T00:00:00.000Z',
  'mode', value->>'mode',
  'reset_reason', 'reset_for_success_gated_retry_logic'
),
updated_at = now()
WHERE key = 'night_frost_last_pushed';

-- Auch alte ungelöste Quota/no_control_channel-Errors als resolved markieren,
-- damit der Quota-Gate-Check sauber neu startet.
UPDATE public.api_errors
SET resolved_at = now()
WHERE source = 'pv-automation'
  AND resolved_at IS NULL
  AND (error_type IN ('no_control_channel', 'night_frost_failed', 'quota_exhausted')
       OR error_message ILIKE '%quota%')
  AND created_at < now() - interval '6 hours';