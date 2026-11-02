-- 19_ki_nur_vorschlaege.sql  (02.11.2026)
-- Konzept doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md (freigegeben 02.11.2026):
-- Die KI ändert keine Einstellung selbst. Alle Parameter der Whitelist auf „suggest“ (Vorschlag) statt „auto“.
-- Wiederholbar. Im SQL-Editor ausführen.

update public.ai_parameter_whitelist set autonomy_level = 'suggest', updated_at = now()
where autonomy_level = 'auto';

-- Prüfen: darf nichts mehr „auto“ zeigen
select parameter_key, scope, autonomy_level, min_value, max_value from public.ai_parameter_whitelist order by parameter_key;
