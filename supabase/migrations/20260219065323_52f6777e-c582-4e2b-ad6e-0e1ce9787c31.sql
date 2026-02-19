
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  retention_raw INTEGER;
  retention_hourly INTEGER;
BEGIN
  -- Hole Retention-Settings (Fallback: 7 Tage raw, 90 Tage hourly)
  SELECT 
    COALESCE(raw_data_retention_days, 7),
    COALESCE(hourly_retention_days, 90)
  INTO retention_raw, retention_hourly
  FROM data_retention_settings
  LIMIT 1;

  -- Falls keine Settings existieren
  IF retention_raw IS NULL THEN retention_raw := 7; END IF;
  IF retention_hourly IS NULL THEN retention_hourly := 90; END IF;

  -- energy_readings: nach raw_data_retention_days bereinigen
  DELETE FROM energy_readings 
  WHERE timestamp < NOW() - (retention_raw || ' days')::INTERVAL;

  -- hourly_aggregates: nach hourly_retention_days bereinigen
  DELETE FROM hourly_aggregates 
  WHERE hour_start < NOW() - (retention_hourly || ' days')::INTERVAL;

  -- room_temperature_samples: 14 Tage behalten
  DELETE FROM room_temperature_samples 
  WHERE timestamp < NOW() - INTERVAL '14 days';

  -- room_heating_logs: 90 Tage behalten (für Heizhistorie)
  DELETE FROM room_heating_logs 
  WHERE timestamp < NOW() - INTERVAL '90 days';

  -- consumer_logs: 30 Tage behalten
  DELETE FROM consumer_logs 
  WHERE start_time < NOW() - INTERVAL '30 days';

  -- solar_heating_events: 30 Tage behalten
  DELETE FROM solar_heating_events 
  WHERE timestamp < NOW() - INTERVAL '30 days';

  -- room_recommendations: 7 Tage behalten
  DELETE FROM room_recommendations 
  WHERE date < CURRENT_DATE - 7;

  -- heating_recommendations: 7 Tage behalten
  DELETE FROM heating_recommendations 
  WHERE date < CURRENT_DATE - 7;

  -- room_ml_features: 90 Tage behalten
  DELETE FROM room_ml_features 
  WHERE date < CURRENT_DATE - 90;

  -- learning_events: 30 Tage
  DELETE FROM learning_events 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- api_errors: gelöste nach 7 Tagen, alle nach 30 Tagen
  DELETE FROM api_errors 
  WHERE resolved_at IS NOT NULL 
    AND created_at < NOW() - INTERVAL '7 days';
  
  DELETE FROM api_errors 
  WHERE created_at < NOW() - INTERVAL '30 days';

  -- pv_forecasts: vergangene Vorhersagen nach 7 Tagen
  DELETE FROM pv_forecasts 
  WHERE date < CURRENT_DATE - 7;

  -- Update last_cleanup_at
  UPDATE data_retention_settings 
  SET last_cleanup_at = NOW(), updated_at = NOW();
END;
$function$;
