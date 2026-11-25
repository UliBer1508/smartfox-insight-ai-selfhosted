-- 58 · Vorhersage-Güte des Raummodells je Nacht (25.11.2026) – doc/PRUEFUNG-ESTRICH-MASSSTAB-2026-11-25.md
-- Vor dem nächtlichen Neu-Lernen (heizplaner aktion „lernen“) sagt das Modell von gestern die seither gemessenen
-- Stunden 12 h voraus (nie gesehen). Angezeigt in „Wo stehen wir?“ › „Lernt das Modell dazu?“.
create table if not exists public.heizmodell_guete (
  tag               date        not null,                  -- Tag der Prüfung (Wiener Zeit)
  room_id           uuid        not null references public.rooms(id) on delete cascade,
  raum              text,
  fehler_12h        numeric,                               -- mittlere Abweichung nach 12 h (°C)
  gleich_12h        numeric,                               -- Vergleich „Temperatur bleibt gleich“ (°C)
  n                 integer,                               -- Fenster (je Stunde eins)
  fehler_12h_heizen numeric,                               -- nur Fenster, in denen geheizt wurde
  n_heizen          integer,
  modell_von        timestamptz,                           -- gelernt_at des geprüften Modells
  erstellt_at       timestamptz not null default now(),
  primary key (tag, room_id)
);

alter table public.heizmodell_guete enable row level security;
drop policy if exists "Authenticated users full access" on public.heizmodell_guete;
create policy "Authenticated users full access" on public.heizmodell_guete
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

-- Prüfung: select * from heizmodell_guete order by tag desc, raum;
