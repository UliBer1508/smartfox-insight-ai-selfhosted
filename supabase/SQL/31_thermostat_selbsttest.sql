-- SQL 31 – Ergebnisse des Thermostat-Selbsttests (10.11.2026, local-collector/tuya-thermostat/thermostat-selbsttest.js)
-- Eine Zeile je Gerät und Testlauf: Netz, Protokollversion, Datenpunkte, Schreibtests (Ton, Soll, Soll+Modus), Befund.
-- Kann gefahrlos mehrfach ausgeführt werden.

create table if not exists public.thermostat_selbsttest (
  id bigserial primary key,
  ts timestamptz not null default now(),
  room_id uuid references public.rooms(id) on delete set null,
  raum text,
  ip text,
  device_id text,
  tcp_ok boolean,
  version text,
  lese_ms integer,
  dps jsonb,
  dp_liste jsonb,
  schreiben_ton jsonb,
  schreiben_soll jsonb,
  schreiben_soll_mit_modus jsonb,
  befund text
);
create index if not exists thermostat_selbsttest_ts on public.thermostat_selbsttest (ts desc);

alter table public.thermostat_selbsttest enable row level security;
-- Der Test läuft am Österreich-PC mit dem Schlüssel aus config.json (anon oder service_role)
drop policy if exists selbsttest_insert on public.thermostat_selbsttest;
create policy selbsttest_insert on public.thermostat_selbsttest for insert to anon, authenticated with check (true);
drop policy if exists selbsttest_select on public.thermostat_selbsttest;
create policy selbsttest_select on public.thermostat_selbsttest for select to authenticated using (true);
