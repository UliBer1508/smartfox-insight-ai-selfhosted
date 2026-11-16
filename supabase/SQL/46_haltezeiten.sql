-- 46_haltezeiten.sql (16.11.2026) – doc/FIX-HIN-UND-HER-STUFE-A-2026-11-16.md
-- Stufe A gegen das Hin und Her der Sollwerte (Konzept doc/KONZEPT-HIN-UND-HER-BEENDEN-2026-11-16.md).
-- Uli: „Ich weiß nicht, was die richtige Haltezeit ist, die wird wahrscheinlich im Laufe des Jahres variieren.“
-- Deshalb keine feste Zahl: beide Werte werden täglich aus den Messwerten gelernt.
--
--   halte_min       Wie lange ein Befehl mindestens gilt, bevor er umgekehrt werden darf.
--                   = Zeit vom Befehl bis zur ersten Lesung „heizt“ nach einem Anstoß, 90 %-Wert der letzten 7 Tage,
--                     aufgerundet auf volle Minuten, 5…20 min. Ohne genug Daten (< 20): 10 min.
--   pv_halten_min   Wie lange PV-Budget über einen Einbruch der Einspeisung hält.
--                   = Dauer kurzer Einbrüche (Einspeisung ≥ 200 W → < 50 W → wieder ≥ 200 W, 9–15 Uhr, ≤ 60 min),
--                     90 %-Wert der letzten 14 Tage, auf 5 min aufgerundet, 5…30 min. Ohne genug Daten (< 3): 10 min.
--
-- Ergebnis in system_settings „haltezeiten“. Eigene Vorgabe (App) in „haltezeiten_vorgabe“ – null = automatisch.
-- Täglich 03:25 (pg_cron, reines SQL ohne HTTP). Wiederholbar.

create or replace function public.haltezeiten_lernen()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reakt numeric; v_reakt_n int;
  v_dip numeric; v_dip_n int;
  v_halte int; v_pv int;
  v_out jsonb;
begin
  -- 1) Reaktionszeit: Anstoß-Befehl → erste Lesung „heizt“
  with c as (
    select c.room_id, c.created_at from thermostat_commands c
    where c.command = 'set_temp' and c.status = 'executed' and c.reason like '%Anstoß%'
      and c.created_at > now() - interval '7 days'
  ), x as (
    select extract(epoch from (
      select min(s.timestamp) from room_temperature_samples s
      where s.room_id = c.room_id and s.is_heating and s.timestamp >= c.created_at and s.timestamp < c.created_at + interval '40 min'
    ) - c.created_at) / 60 as m
    from c
  )
  select percentile_cont(0.9) within group (order by m), count(m) into v_reakt, v_reakt_n from x where m is not null;

  -- 2) Kurze Einbrüche der Einspeisung tagsüber
  with r as (
    select timestamp t, greatest(-power_io, 0) ex from energy_readings
    where timestamp > now() - interval '14 days'
      and extract(hour from timestamp at time zone 'Europe/Vienna') between 9 and 15
  ), s as (
    select t, case when ex >= 200 then 'hoch' when ex < 50 then 'tief' else 'mitte' end z from r
  ), g as (
    select t, z, sum(case when z is distinct from lz then 1 else 0 end) over (order by t) grp
    from (select *, lag(z) over (order by t) lz from s) q
  ), b as (
    select grp, z, min(t) a, extract(epoch from max(t) - min(t)) / 60 + 5 as dauer from g group by grp, z
  ), d as (
    select *, lag(z) over (order by a) vor, lead(z) over (order by a) nach from b
  )
  select percentile_cont(0.9) within group (order by dauer), count(*) into v_dip, v_dip_n
  from d where z = 'tief' and vor = 'hoch' and nach = 'hoch' and dauer <= 60;

  v_halte := case when coalesce(v_reakt_n, 0) >= 20 then least(20, greatest(5, ceil(v_reakt)::int)) else 10 end;
  v_pv := case when coalesce(v_dip_n, 0) >= 3 then least(30, greatest(5, (ceil(v_dip / 5) * 5)::int)) else 10 end;

  v_out := jsonb_build_object(
    'halte_min', v_halte,
    'pv_halten_min', v_pv,
    'reaktion_p90_min', round(coalesce(v_reakt, 0), 1), 'reaktion_n', coalesce(v_reakt_n, 0),
    'einbruch_p90_min', round(coalesce(v_dip, 0), 1), 'einbruch_n', coalesce(v_dip_n, 0),
    'computed_at', now()
  );
  insert into system_settings (key, value, updated_at) values ('haltezeiten', v_out, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_out;
end;
$$;

-- Eigene Vorgabe (null = automatisch); die App schreibt hier.
insert into public.system_settings (key, value)
values ('haltezeiten_vorgabe', '{"halte_min": null, "pv_halten_min": null}'::jsonb)
on conflict (key) do nothing;

-- Kennzahl „Hin und Her“: Anteil der Sollwert-Befehle, die innerhalb von 15 min einen Wert verlassen und wieder
-- zurückkehren (A → B → A), je Wiener Kalendertag. Für „Heizung jetzt“ und die Prüfung der Stufe A.
create or replace function public.hin_und_her_tage(p_tage int default 7)
returns table (tag date, befehle int, hin_und_her int, anteil numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (
    select c.room_id, c.created_at, c.value,
           lag(c.value) over p v1, lag(c.value, 2) over p v2, lag(c.created_at, 2) over p t2
    from thermostat_commands c
    where c.command = 'set_temp' and c.created_at > now() - make_interval(days => greatest(1, least(p_tage, 31)) + 1)
    window p as (partition by c.room_id order by c.created_at)
  )
  select (created_at at time zone 'Europe/Vienna')::date,
         count(*)::int,
         (count(*) filter (where v2 = value and v1 <> value and created_at - t2 < interval '15 minutes'))::int,
         round(100.0 * count(*) filter (where v2 = value and v1 <> value and created_at - t2 < interval '15 minutes') / greatest(count(*), 1), 1)
  from c
  where created_at > now() - make_interval(days => greatest(1, least(p_tage, 31)))
  group by 1 order by 1;
$$;

grant execute on function public.hin_und_her_tage(int) to authenticated;

select cron.unschedule('haltezeiten-lernen') where exists (select 1 from cron.job where jobname = 'haltezeiten-lernen');
select cron.schedule('haltezeiten-lernen', '25 2 * * *', $$select public.haltezeiten_lernen()$$);  -- 03:25 Wien (UTC+1)

select public.haltezeiten_lernen();
