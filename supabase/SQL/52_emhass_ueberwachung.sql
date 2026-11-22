-- 52 · Systemstatus: EMHASS-Vergleich überwachen (22.11.2026) – doc/EMHASS-VERGLEICH-2026-11-22.md
-- Uli: „Ich kann nicht jeden Tag am PC etwas machen oder prüfen.“ Die Brücke läuft per Aufgabenplanung (03:45), nicht
-- als NSSM-Dienst – der Dienste-Wächter sieht sie nicht. Deshalb prüft system_problems() das Ergebnis: Fehlt nach
-- 06:00 Uhr der EMHASS-Wert für gestern, erscheint ein Problem (Symbol in der App + Mail über system-alert).
-- Erst aktiv, sobald es überhaupt EMHASS-Werte gibt. Ergänzt nur einen Block vor dem Ende der Funktion.
do $$
declare v_def text; v_block text;
begin
  v_def := pg_get_functiondef('public.system_problems()'::regprocedure);
  if position('cloud:emhass' in v_def) > 0 then raise notice 'schon ergänzt'; return; end if;
  v_block := $b$
  -- 22.11.2026 (SQL 52): EMHASS-Vergleich vom Österreich-PC (Aufgabe „EMHASS Vergleich“ 03:45)
  if (now() at time zone 'Europe/Vienna')::time >= time '06:00'
     and exists (select 1 from heizplan_vergleich where emhass is not null)
     and not exists (select 1 from heizplan_vergleich
                      where tag = (now() at time zone 'Europe/Vienna')::date - 1 and emhass is not null) then
    res := res || jsonb_build_object('key', 'cloud:emhass', 'area', 'Österreich-PC',
      'text', 'EMHASS-Vergleich für gestern fehlt (Aufgabe „EMHASS Vergleich“ 03:45, Protokoll C:\EMHASS\bruecke.log)');
  end if;

  return res;$b$;
  if (length(v_def) - length(replace(v_def, 'return res;', ''))) / length('return res;') <> 1 then
    raise exception 'system_problems: „return res;“ nicht eindeutig – nicht geändert';
  end if;
  execute replace(v_def, E'\n  return res;', v_block);
end $$;

-- Prüfung: select system_problems();
