-- 26 · Komfort ist das Maximum (07.11.2026, Uli)
-- „Estrich laden bis“ (rooms.pv_boost_max_temp) ist abgeschafft: die KI schlägt den Wert nicht mehr vor,
-- offene Vorschläge dazu werden geschlossen. Die Spalte bleibt (alte Daten, Typen), wird aber nicht mehr gelesen.
-- Bereits am 07.11.2026 per Supabase-Connector ausgeführt.
update ai_parameter_whitelist set enabled = false, autonomy_level = 'shadow' where parameter_key = 'pv_boost_max_temp';
update ki_vorschlaege set status = 'abgelehnt', entschieden_at = now(),
       notiz = '07.11.2026: Wert abgeschafft – Komfort ist das Maximum (Uli)'
 where parameter_key = 'pv_boost_max_temp' and status = 'offen';
