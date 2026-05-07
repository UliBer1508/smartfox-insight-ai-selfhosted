REVOKE EXECUTE ON FUNCTION public.get_ml_follow_rate(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ml_follow_rate(integer) TO authenticated;