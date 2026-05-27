
-- 1) Remove anon INSERT policies (these tables are written only by edge functions w/ service_role)
DROP POLICY IF EXISTS "Service role can write decisions" ON public.ai_parameter_decisions;
DROP POLICY IF EXISTS "Service inserts suggestions" ON public.battery_soc_suggestions;

-- 2) Lock down internal SECURITY DEFINER functions (trigger helpers + maintenance routines)
-- These are not meant to be called via the Data API.
REVOKE EXECUTE ON FUNCTION public.cleanup_old_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_thermostat_commands() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_ai_parameter_decisions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_ai_auto_apply() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_learned_policy_hour() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_energy_reading() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_room_temperature_sample() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_rooms_sensitive_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_previous_price_history() FROM PUBLIC, anon, authenticated;

-- Keep these RPCs callable (used by UI / edge functions):
-- get_weekly_energy_summary, get_heating_history, match_today_pattern, get_ml_follow_rate
GRANT EXECUTE ON FUNCTION public.get_weekly_energy_summary(integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_heating_history(integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.match_today_pattern(jsonb, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_ml_follow_rate(integer) TO authenticated, anon;
