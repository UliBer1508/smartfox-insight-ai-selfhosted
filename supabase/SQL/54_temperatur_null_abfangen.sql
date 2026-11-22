-- 54 · WLAN-Ausfall schreibt 0 °C als Raumtemperatur – abfangen (22.11.2026) – doc/FIX-PLANER-HIGHS-2026-11-22.md
-- Befund: Toilette Eingang 17.11. 00:15–03:15 (37 Werte) und Zimmer Luis 20.11. 18:32–21:37 (38 Werte) mit 0 °C in
-- room_temperature_samples. Folge: Raummodell lernt „kühlt stark aus“ (Toilette: Min 21 °C angeblich nicht haltbar,
-- obwohl der Raum meist ≥ 21 °C hat – Uli: „Toilette ist meist auf 21“); die Steuerung sähe einen 0-°C-Raum.
-- Uli: „Toilette ist sehr schlecht für WLAN, wenn die Tür fast zu ist.“
--
-- 1. Trigger vor allen anderen auf rooms: Raumtemperatur < 3 °C = keine Lesung → alter Wert und alter Lesezeitpunkt
--    bleiben (kein neuer Messwert, der Systemstatus meldet den Ausfall weiter über thermostat_state/read_at).
create or replace function public.trg_raumtemp_ungueltig()
returns trigger language plpgsql as $$
begin
  if new.current_temp is not null and new.current_temp < 3 then
    new.current_temp := old.current_temp;
    new.last_thermostat_sync := old.last_thermostat_sync;
  end if;
  return new;
end $$;
drop trigger if exists a0_trg_raumtemp_ungueltig on public.rooms;   -- Name sortiert vor a_trg_fuehler_plausibel
create trigger a0_trg_raumtemp_ungueltig before update on public.rooms
  for each row execute function public.trg_raumtemp_ungueltig();

-- 2. Vorhandene ungültige Messwerte sichern und entfernen (das Raummodell lernt nachts aus den letzten 30 Tagen)
create table if not exists public.room_temperature_samples_ungueltig as
  select * from public.room_temperature_samples where false;
insert into public.room_temperature_samples_ungueltig
  select * from public.room_temperature_samples where temperature < 3;
delete from public.room_temperature_samples where temperature < 3;
alter table public.room_temperature_samples_ungueltig enable row level security;

-- Prüfung: select count(*) from room_temperature_samples_ungueltig;
