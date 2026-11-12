// Zeiträume für KI › Verlauf (12.11.2026): Tag, Woche (Mo–So), Monat, Jahr – alles in Wiener Ortszeit.
import { TZ } from './planerTeile';
import type { Periode, Vergleich } from './VerlaufAnsicht';

const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const parse = (d: string) => { const [y, m, t] = d.split('-').map(Number); return { y, m, t }; };
const fmt = (y: number, m: number, t: number) => { const x = new Date(Date.UTC(y, m - 1, t)); return x.toISOString().slice(0, 10); };
export const plusTage = (d: string, n: number) => { const { y, m, t } = parse(d); return fmt(y, m, t + n); };
const tm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Mitternacht Wiener Zeit des Kalendertags d als UTC-Millisekunden. */
export function wienMs(d: string): number {
  const { y, m, t } = parse(d);
  const guess = Date.UTC(y, m - 1, t);
  const h = Number(new Date(guess).toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }));
  return guess - h * 3600_000;   // h = 1 (Winter) oder 2 (Sommer)
}
export const heuteWien = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

function kw(d: string) {
  const { y, m, t } = parse(d);
  const x = new Date(Date.UTC(y, m - 1, t));
  const wt = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - wt + 3);
  const j1 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((x.getTime() - j1.getTime()) / 86400000 - 3 + ((j1.getUTCDay() + 6) % 7)) / 7);
}

/** Beginn (inkl.), Ende (exkl.) und Titel des Zeitraums, in dem `anker` liegt. */
export function bereich(periode: Periode, anker: string): { von: string; bis: string; titel: string } {
  const { y, m, t } = parse(anker);
  if (periode === 'tag') {
    const wt = new Date(Date.UTC(y, m - 1, t)).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' });
    return { von: anker, bis: plusTage(anker, 1), titel: `${wt} ${tm(anker)}${y}` };
  }
  if (periode === 'woche') {
    const wt = (new Date(Date.UTC(y, m - 1, t)).getUTCDay() + 6) % 7;
    const von = plusTage(anker, -wt);
    return { von, bis: plusTage(von, 7), titel: `KW ${kw(von)} · ${tm(von)}–${tm(plusTage(von, 6))}` };
  }
  if (periode === 'monat') return { von: fmt(y, m, 1), bis: fmt(y, m + 1, 1), titel: `${MONATE_LANG[m - 1]} ${y}` };
  return { von: fmt(y, 1, 1), bis: fmt(y + 1, 1, 1), titel: String(y) };
}

/** Anker um n Zeiträume verschieben. */
export function verschieben(periode: Periode, anker: string, n: number): string {
  const { y, m, t } = parse(anker);
  if (periode === 'tag') return plusTage(anker, n);
  if (periode === 'woche') return plusTage(anker, 7 * n);
  if (periode === 'monat') return fmt(y, m + n, Math.min(t, 28));
  return fmt(y + n, m, Math.min(t, 28));
}

/** Vergleichszeitraum: vorheriger Zeitraum oder derselbe Zeitraum ein Jahr früher. */
export function vergleichAnker(periode: Periode, anker: string, v: Vergleich): string | null {
  if (v === 'aus') return null;
  if (v === 'vorjahr' && periode !== 'jahr') {
    if (periode === 'woche') return plusTage(anker, -364);   // gleiche Kalenderwoche, gleicher Wochentag
    const { y, m, t } = parse(anker);
    return fmt(y - 1, m, Math.min(t, 28));
  }
  return verschieben(periode, anker, -1);
}
