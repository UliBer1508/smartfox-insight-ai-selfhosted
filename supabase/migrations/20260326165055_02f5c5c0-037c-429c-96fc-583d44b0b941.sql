UPDATE system_settings SET value = '{"mode": "cloud"}'::jsonb, updated_at = now() WHERE key = 'tuya_control_mode';
DELETE FROM thermostat_commands WHERE status = 'pending';
UPDATE api_errors SET resolved_at = now() WHERE error_type = 'local_service_offline' AND resolved_at IS NULL;