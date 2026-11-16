// deno test supabase/functions/pv-automation/planer_pv_test.ts
import { planerPvW, planerPvWh, type PlanerPv } from './planer_pv.ts';

function gleich(a: number, b: number, msg: string) {
  if (Math.abs(a - b) > 1e-6) throw new Error(`${msg}: ${a} ≠ ${b}`);
}

// Plan 15.11.2026 06:00 (Auszug): 08:00 526 W, 09:00 3906 W … je 4 Abschnitte
const start = Date.UTC(2026, 10, 15, 5, 0, 0) / 1000;           // 06:00 Wien
const stunden = [0, 0, 526, 3906, 5907, 6438, 6912, 5586, 3331, 940, 221, 14];
const p: PlanerPv = { start, pv: stunden.flatMap(w => [w, w, w, w]), grund: 'Test' };

Deno.test('Abschnitt je Uhrzeit', () => {
  gleich(planerPvW(p, start), 0, '06:00');
  gleich(planerPvW(p, start + 2 * 3600 + 600), 526, '08:10');
  gleich(planerPvW(p, start - 1), 0, 'vor dem Plan');
  gleich(planerPvW(p, start + 48 * 900), 0, 'nach dem Plan');
});

Deno.test('Energie bis Sonnenuntergang, laufender Abschnitt anteilig', () => {
  const tag = stunden.reduce((s, w) => s + w, 0);                // Wh (1 h je Wert)
  gleich(planerPvWh(p, start, start + 12 * 3600), tag, 'ganzer Plan');
  // 12:07:30 bis 16:40 – Abschnitt 12:00–12:15 zählt 7,5 min
  const von = start + 6 * 3600 + 450, bis = start + 10 * 3600 + 40 * 60;
  const erwartet = 6912 * 0.125 + 6912 * 0.75 + 5586 + 3331 + 940 + 221 * (40 / 60);
  gleich(planerPvWh(p, von, bis), erwartet, '12:07:30–16:40');
  gleich(planerPvWh(p, bis, von), 0, 'leer');
});
