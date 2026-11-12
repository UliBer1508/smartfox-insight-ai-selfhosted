-- SQL 32 – KI-Lerndaten bereinigen (10.11.2026, doc/FIX-PRUEFUNG-REST-2026-11-10.md, K4)
-- Kinder Bad nahm seit mindestens 01.11. keinen Befehl an. Seine 1774 Lern-Ereignisse der letzten 14 Tage (die Hälfte
-- aller Ereignisse) wurden trotzdem als Erfolg bewertet („Ziel erreicht“, weil der Raum ohnehin über dem Absenkziel lag)
-- und ergaben 14 Policies mit bis zu 100 % „Erfolg“.
-- Ereignisse bleiben erhalten (Nachvollziehbarkeit), fallen aber aus dem Lernen: reward = null (update-learned-policies
-- liest nur reward is not null). Die daraus entstandenen Policies werden gelöscht.

update public.learning_events e
   set reward = null,
       outcome = coalesce(e.outcome, '{}'::jsonb) || jsonb_build_object('ausgeschlossen', 'Thermostat nahm keine Befehle an (SQL 32, 10.11.2026)')
 where e.room_id = (select id from public.rooms where name = 'Kinder Bad')
   and e.timestamp >= '2026-10-01';

delete from public.learned_policies
 where room_id = (select id from public.rooms where name = 'Kinder Bad');

-- noch unbewertete Ereignisse nicht nachträglich bewerten lassen
update public.learning_events set is_evaluated = true
 where room_id = (select id from public.rooms where name = 'Kinder Bad') and is_evaluated = false and reward is null;

-- Ausgeführt am 10.11.2026: 2042 Ereignisse ausgeschlossen (+ 19 unbewertete), 14 Policies gelöscht.
