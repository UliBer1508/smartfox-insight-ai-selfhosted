-- 57 · Systemstatus: EMHASS „Lauf fehlt“ von „keine Lösung“ trennen (25.11.2026) – doc/FIX-EMHASS-INFEASIBLE-2026-11-25.md
-- Anlass: Am 25.11. meldete der Systemstatus „EMHASS-Vergleich für gestern fehlt“, obwohl die Aufgabe um 03:45 lief –
-- EMHASS hatte nur keine Lösung gefunden (Infeasible), HiGHS hatte gerechnet. Neu:
--   • Lauf fehlt (weder EMHASS noch HiGHS für gestern)   → Problem wie bisher („ist nicht gelaufen“)
--   • Lauf da, aber EMHASS ohne Lösung                    → erst ein Problem, wenn das 2 Tage hintereinander passiert
--     (ein einzelner Tag ohne Lösung steht nur in bruecke.log; nach dem Fix vom 25.11. sollte das selten sein)
-- Ersetzt nur den Block aus SQL 52 in system_problems().
do $$
declare v_def text; v_alt text; v_neu text;
begin
  v_def := pg_get_functiondef('public.system_problems()'::regprocedure);
  if position('SQL 57' in v_def) > 0 then raise notice 'schon geändert'; return; end if;
  v_alt := substring(v_def from '  -- 22\.11\.2026 \(SQL 52\).*?  end if;\n');
  if v_alt is null then raise exception 'system_problems: Block aus SQL 52 nicht gefunden – nicht geändert'; end if;
  v_neu := $b$  -- 25.11.2026 (SQL 57, ersetzt SQL 52): EMHASS-Vergleich vom Österreich-PC (Aufgabe „EMHASS Vergleich“ 03:45)
  if (now() at time zone 'Europe/Vienna')::time >= time '06:00'
     and exists (select 1 from heizplan_vergleich where emhass is not null) then
    if not exists (select 1 from heizplan_vergleich
                    where tag = (now() at time zone 'Europe/Vienna')::date - 1
                      and (emhass is not null or planer_highs is not null)) then
      res := res || jsonb_build_object('key', 'cloud:emhass', 'area', 'Österreich-PC',
        'text', 'EMHASS-Vergleich für gestern ist nicht gelaufen (Aufgabe „EMHASS Vergleich“ 03:45, Protokoll C:\EMHASS\bruecke.log)');
    elsif not exists (select 1 from heizplan_vergleich
                       where tag between (now() at time zone 'Europe/Vienna')::date - 2
                                     and (now() at time zone 'Europe/Vienna')::date - 1
                         and emhass is not null) then
      res := res || jsonb_build_object('key', 'cloud:emhass', 'area', 'Österreich-PC',
        'text', 'EMHASS findet seit 2 Tagen keine Lösung (Lauf ok, HiGHS gerechnet) – C:\EMHASS\laeufe\<Tag>\emhass.log');
    end if;
  end if;
$b$;
  execute replace(v_def, v_alt, v_neu);
end $$;

-- Prüfung: select system_problems();
