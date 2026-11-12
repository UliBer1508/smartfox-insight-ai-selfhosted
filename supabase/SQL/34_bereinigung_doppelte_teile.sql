-- 34 – Bereinigung doppelter Teile, Stufe 1 (12.11.2026, doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md)
--
-- Uli, 12.11.2026: „Ich möchte, dass wir die doppelt entwickelten Teile durch die neuere bessere Variante ersetzen.“
-- Stufe 1 = nur Teile ohne Wirkung auf die Steuerung (nachgewiesen im Dokument). Ersetzt durch:
--   KI-Tagesplaner (ai-daily-planner)              → Heizplaner (heizplaner)
--   gelernte Policies (update-learned-policies)    → Heizplaner
--   Sonnen-Überwachung (monitor-solar-heating)     → „Fühler in der Sonne“ (pv-automation, 09.11.) + Heizmodell (s)
--   Solar-Analyse (analyze-solar-gain)             → Heizmodell (k, s)
--   altes Nacht-Raummodell (raum_abkuehlung)       → Heizmodell (k, c) – pv-automation rechnet die Vorausschau daraus
--
-- Tabellen und Daten bleiben (nichts wird gelöscht). Rückgängig: Cron-Jobs mit SQL 14/18 bzw. dem Dashboard neu anlegen.

-- 1) Zeitpläne der ersetzten Funktionen entfernen
do $$
declare j text;
begin
  foreach j in array array['ai-daily-planner-06am', 'update-learned-policies-daily', 'solar-heating-monitor', 'daily-solar-analysis'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice 'Cron entfernt: %', j;
    end if;
  end loop;
end $$;

-- 2) Nacht-Protokoll ohne das alte Raummodell (vorher: raum_abkuehlung_nacht um 09:55)
create or replace function public.nacht_protokoll_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_local timestamp := now() at time zone 'Europe/Vienna';
begin
  if extract(hour from v_local) = 21 then
    perform nacht_einstellungen_merken(v_local::date);
    perform tag_einstellungen_merken(v_local::date);
  end if;
  if extract(hour from v_local) = 9 then
    perform nacht_auswerten(v_local::date - 1);
    perform tag_bewerten(v_local::date - 1);
    -- 12.11.2026: raum_abkuehlung_nacht entfällt – ersetzt durch das Heizmodell des Planers (heizmodell, 03:00)
  end if;
end $function$;

-- Prüfen
select jobname from cron.job
 where jobname in ('ai-daily-planner-06am', 'update-learned-policies-daily', 'solar-heating-monitor', 'daily-solar-analysis');
-- erwartet: keine Zeile
