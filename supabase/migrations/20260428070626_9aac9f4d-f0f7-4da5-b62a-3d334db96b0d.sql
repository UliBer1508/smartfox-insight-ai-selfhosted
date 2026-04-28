-- Cleanup: Resolve nightly Tuya quota errors that have been spamming the banner
UPDATE api_errors
SET resolved_at = NOW()
WHERE resolved_at IS NULL
  AND error_type IN ('night_frost_failed', 'no_control_channel', 'tuya_api')
  AND created_at >= NOW() - INTERVAL '24 hours';

-- Reset today's call counter (monthly counter stays — Tuya server-side blocks until next month)
UPDATE system_settings
SET value = jsonb_set(value, '{calls_today}', '0'::jsonb),
    updated_at = NOW()
WHERE key = 'tuya_api_quota';

-- Initialize the night-quiet gate so this current night does not push again
INSERT INTO system_settings (key, value)
VALUES ('night_frost_last_pushed', jsonb_build_object('night', '2026-04-27', 'pushed_at', NOW(), 'rooms', 0, 'mode', 'manual_init'))
ON CONFLICT (key) DO UPDATE
  SET value = jsonb_build_object('night', '2026-04-27', 'pushed_at', NOW(), 'rooms', 0, 'mode', 'manual_init'),
      updated_at = NOW();