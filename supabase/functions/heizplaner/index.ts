// heizplaner (06.11.2026) – doc/KONZEPT-PLANER-2026-11-06.md
//
// Statt fester Regeln rechnet der Planer: Für die nächsten 24 h sucht er je Raum und halbe Stunde „heizen ja/nein“,
// sodass möglichst wenig Netzstrom gebraucht wird und die Räume ihre Ziele halten (Eco tags, Nachtwert nachts,
// Untergrenze, nie unter Untergrenze − Sicherheitsabstand). Eingaben: gelerntes Raummodell, gelernte PV-Vorhersage
// (an der gemessenen PV nachgeführt), Batterie, Grundlast, Leistungsgrenze.
//
// SCHATTENBETRIEB: Der Planer steuert nichts. Er schreibt seinen Plan in `heizplan` und vergleicht jeden Tag mit der
// heutigen Steuerung (`heizplan_vergleich`). Steuern kommt erst nach Ulis Freigabe.
//
// Aufrufe (POST, Body oder Query `aktion`):
//   planen            – alle 15 min (analysis-scheduler)
//   lernen  raum=<id> – Raummodell eines Raums lernen (03:00, je Raum ein Aufruf wegen der Rechenzeit-Grenze)
//   pv_lernen         – PV-Vorhersage je Stunde lernen (03:00)
//   vergleich tag=…   – Gegenrechnung eines Tages (Standard: gestern)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  BLOCK, SLOTS, bewerte, estrichAus, lernePv, lerneRaum, nachfuehrFaktor, plane, prognoseFehler, pvVorhersage,
  type Batterie, type Fenster, type Gewichte, type PlanRaum, type PlanSlot, type PvModell, type RaumParam,
} from './modell.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STANDARD_PARAM: RaumParam = { k: 0.01, g: 0.4, s: 0, c: 0.12, tau: 0 };
const PLAN_AUFBEWAHREN_TAGE = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
async function authorize(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.replace('Bearer ', '');
  const known = [SERVICE_KEY, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  if (known.includes(token)) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return ['authenticated', 'service_role'].includes(payload.role || payload.aud);
  } catch { return false; }
}

// ---------------------------------------------------------------- Zeit (Wiener Ortszeit)
const FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const wall = (ep: number) => FMT.format(new Date(ep * 1000)).replace(',', '');     // „YYYY-MM-DD HH:MM“
export const wkey = (ep: number) => wall(ep).slice(0, 13);
const minuten = (hhmm: string | null | undefined, fb: string) => { const [h, m] = String(hhmm || fb).split(':').map(Number); return h * 60 + (m || 0); };
/** Epoch-Sekunden von Mitternacht (Wiener Zeit) eines Tages. */
export function mitternacht(tag: string): number {
  let ep = Date.UTC(Number(tag.slice(0, 4)), Number(tag.slice(5, 7)) - 1, Number(tag.slice(8, 10))) / 1000 - 3 * 3600;
  for (let i = 0; i < 24 && wall(ep) !== `${tag} 00:00`; i++) ep += 900;
  return ep;
}

// ---------------------------------------------------------------- Daten aufbereiten
export interface Daten {
  jetzt: number; settings: any; grundlast: number | null; raeume: any[];
  modell: Record<string, { param: RaumParam; heiz_std: number; prior: boolean }> | null;
  pv_modell: { coef: PvModell } | null;
  energie15: [number, number, number, number, number][];
  samples15: Record<string, [number, number, number][]> | null;
  wetter: [string, number, number, number][];
  pv_h: [string, number][];
}
export function aufbereiten(d: Daten) {
  const wet = new Map<string, { dir: number; dif: number; t: number }>((d.wetter ?? []).map(w => [w[0], { dir: Number(w[1]) || 0, dif: Number(w[2]) || 0, t: Number(w[3]) }]));
  const e15 = new Map<number, number[]>((d.energie15 ?? []).map(r => [Number(r[0]), r.map(Number)]));
  const pvIst = new Map<string, number>((d.pv_h ?? []).map(r => [r[0], Number(r[1])]));
  const smp = new Map<string, Map<number, { t: number; h: number }>>();
  for (const [rid, arr] of Object.entries(d.samples15 ?? {})) smp.set(rid, new Map(arr.map(a => [Number(a[0]), { t: Number(a[1]), h: Number(a[2]) }])));
  return { wet, e15, pvIst, smp };
}
type Aufb = ReturnType<typeof aufbereiten>;

function fensterFuer(a: Aufb, rid: string, alleH: number, laengeH: number): Fenster[] {
  const m = a.smp.get(rid);
  if (!m) return [];
  const out: Fenster[] = [];
  for (const t0 of [...m.keys()].sort((x, y) => x - y)) {
    if (t0 % (alleH * 3600) !== 0) continue;
    const st = Array.from({ length: laengeH * 4 }, (_, i) => t0 + 900 * i);
    if (!st.every(x => m.has(x) && a.e15.has(x) && a.wet.has(wkey(x)))) continue;
    out.push({
      T0: m.get(t0)!.t,
      hist: Array.from({ length: 48 }, (_, i) => m.get(t0 - 900 * (48 - i))?.h ?? 0),
      h: st.map(x => m.get(x)!.h), tout: st.map(x => a.wet.get(wkey(x))!.t),
      pvkw: st.map(x => a.e15.get(x)![2] / 1000), tIst: st.map(x => m.get(x + 900)?.t ?? null),
    });
  }
  return out;
}

function gewichte(s: any): Gewichte {
  const buy = Number(s?.electricity_price_kwh_cent) || 30, feed = Number(s?.feed_in_price_kwh_cent) || 8;
  return { ziel: Number(s?.planer_gewicht_ziel ?? 0.6), unter: Number(s?.planer_gewicht_unter ?? 2), sicher: 30, ueber: 0.2,
           einspeiseFaktor: Math.min(1, feed / buy), batterieRest: 0.9 };
}

/** Räume und Slots für einen Plan ab `start` aufbauen. pvVon(ep) liefert die PV je Slot (W). */
function baue(d: Daten, a: Aufb, start: number, pvVon: (ep: number, i: number) => number,
              T0: (r: any) => number | null, festVon?: (r: any, ep: number, i: number) => 0 | 1 | null) {
  const s = d.settings ?? {};
  const ns = minuten(s.night_start_time, '22:00'), ne = minuten(s.night_end_time, '08:00');
  const base = Number(d.grundlast) || 240;
  const cap = Math.max(0, Number(s.max_grid_heating_power_w ?? 2000));
  const abst = Number(s.planer_sicherheit_abstand ?? 1.5);
  const eps = Array.from({ length: SLOTS }, (_, i) => start + 900 * i);
  const nacht = eps.map(ep => { const w = wall(ep); const m = Number(w.slice(11, 13)) * 60 + Number(w.slice(14, 16)); return ns > ne ? (m >= ns || m < ne) : (m >= ns && m < ne); });
  const slots: PlanSlot[] = eps.map((ep, i) => {
    const pv = pvVon(ep, i);
    return { pv, base, tout: a.wet.get(wkey(ep))?.t ?? 3, pvkw: pv / 1000, capW: cap + Math.max(0, pv - base) };
  });
  const raeume: PlanRaum[] = [];
  for (const r of d.raeume) {
    const t0 = T0(r);
    if (t0 == null || !Number.isFinite(t0)) continue;
    const param = d.modell?.[r.id]?.param ?? STANDARD_PARAM;
    const m = a.smp.get(r.id);
    const S0 = estrichAus(Array.from({ length: 48 }, (_, i) => m?.get(start - 900 * (48 - i))?.h ?? 0), param.tau);
    const eco = Number(r.eco ?? s.eco_temp ?? 21);
    const unter = Number(r.unter ?? eco - 1.5);
    const nachtZiel = Math.max(Number(r.nacht ?? s.night_temp ?? unter), unter);
    raeume.push({
      id: r.id, name: r.name, p: Number(r.p) || 800, T0: t0, S0, param,
      ziel: nacht.map(n => (n ? nachtZiel : eco)), unter: eps.map(() => unter), sicher: eps.map(() => unter - abst),
      max: eps.map(() => Number(r.komfort ?? eco + 1)),   // 07.11.2026: Komfort ist das Maximum (kein eigener Estrich-Wert mehr)
      gewicht: 1 + (12 - (Number(r.prio) || 12)) / 12,
      fest: eps.map((ep, i) => (festVon ? festVon(r, ep, i) : null)),
    });
  }
  return { slots, raeume, eps, nacht };
}

function batterieVon(d: Daten, socProzent: number): Batterie {
  const cap = Number(d.settings?.battery_capacity_kwh) || 13.8;
  return { eKwh: cap * socProzent / 100, capKwh: cap, minKwh: cap * 0.05, maxLadenW: 5500, maxEntladenW: 5700, eta: 0.95 };
}
const letzterSoc = (a: Aufb, bis: number) => { let best = -1, soc = 50; for (const [k, v] of a.e15) if (k <= bis && k > best) { best = k; soc = v[3]; } return soc; };
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- Aktionen
async function planen(sb: any) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: 2 });
  if (error) throw new Error(`heizplaner_daten: ${error.message} (SQL 25 ausgeführt?)`);
  if ((d.settings?.planer_modus ?? 'schatten') === 'aus') return { ok: true, aus: true };
  const a = aufbereiten(d);
  const start = Math.floor(d.jetzt / 900) * 900;
  const pvm: PvModell = d.pv_modell?.coef ?? lernePv(a.pvIst, a.wet);

  // Nachführung an der gemessenen PV der letzten 2 vollen Stunden
  let ist2 = 0, vor2 = 0;
  for (let hh = 1; hh <= 2; hh++) {
    const ep = start - hh * 3600;
    const k = wkey(ep);
    const werte = [0, 1, 2, 3].map(q => a.e15.get(Math.floor(ep / 3600) * 3600 + q * 900)?.[2]).filter(v => v != null) as number[];
    if (werte.length) ist2 += werte.reduce((s, v) => s + v, 0) / werte.length;
    vor2 += pvVorhersage(pvm, k, a.wet.get(k));
  }
  const f = nachfuehrFaktor(ist2, vor2);
  const pvVon = (ep: number, i: number) => pvVorhersage(pvm, wkey(ep), a.wet.get(wkey(ep))) * (1 + (f - 1) * Math.max(0, 1 - (i * 0.25) / 4));

  const jetztMs = d.jetzt * 1000;
  const fest = (r: any, ep: number) => {
    if (r.auto === false) return (ep === start && r.heizt) ? 1 : 0;                                        // Automatik aus: nicht planen
    if (r.manuell_bis && new Date(r.manuell_bis).getTime() > ep * 1000) return r.heizt ? 1 : 0;          // manuell: so lassen
    return null;
  };
  const { slots, raeume, eps } = baue(d, a, start, pvVon, r => (r.t == null ? null : Number(r.t)), fest);
  const bat = batterieVon(d, letzterSoc(a, d.jetzt));
  const g = gewichte(d.settings);
  const erg = plane(raeume, slots, bat, g);

  const jetzt = raeume.map((r, i) => {
    const room = d.raeume.find((x: any) => x.id === r.id);
    const planHeizt = erg.heizen[i][0] === 1;
    // nächster Heizbeginn / Heizende im Plan
    const naechstAn = erg.heizen[i].findIndex(v => v === 1);
    const naechstAus = planHeizt ? erg.heizen[i].findIndex(v => v === 0) : -1;
    return {
      room_id: r.id, name: r.name, t: r.T0, plan_heizt: planHeizt, steuerung_heizt: !!room?.heizt,
      manuell: !!(room?.manuell_bis && new Date(room.manuell_bis).getTime() > jetztMs), auto: room?.auto !== false,
      naechst_an: naechstAn >= 0 ? new Date(eps[naechstAn] * 1000).toISOString() : null,
      bis: naechstAus > 0 ? new Date(eps[naechstAus] * 1000).toISOString() : null,
      t_min: r1(Math.min(...erg.temp[i])), t_max: r1(Math.max(...erg.temp[i])),
    };
  });
  const plan = {
    start, slot_min: 15, block: BLOCK,
    pv: slots.map(s => Math.round(s.pv)), heiz: erg.heizW.map(Math.round), netz: erg.netzW.map(Math.round),
    einsp: erg.einspeisW.map(Math.round), bat: erg.batKwh.map(r1), tout: slots.map(s => r1(s.tout)),
    raeume: raeume.map((r, i) => ({ id: r.id, name: r.name, p: r.p, h: erg.heizen[i].join(''), t: erg.temp[i].map(r1),
      ziel: r.ziel.map(r1), unter: r1(r.unter[0]) })),
    gewichte: g, batterie_start: r1(bat.eKwh), schritte: erg.schritte,
  };
  const pvKwh = slots.reduce((s, x) => s + x.pv, 0) / 4000;
  const { error: insErr } = await sb.from('heizplan').insert({
    start_at: new Date(start * 1000).toISOString(), modus: d.settings?.planer_modus ?? 'schatten', plan, jetzt,
    pv_kwh: r1(pvKwh), heiz_kwh: r1(erg.heizKwh), netz_kwh: r1(erg.netzKwh), einspeis_kwh: r1(erg.einspeisKwh),
    unter_ziel_gradstd: r1(erg.komfortGradStd), unter_grenze_gradstd: r1(erg.unterGradStd), nachfuehrung: Math.round(f * 100) / 100,
  });
  if (insErr) throw new Error(`heizplan: ${insErr.message}`);
  await sb.from('heizplan').delete().lt('erstellt_at', new Date(Date.now() - PLAN_AUFBEWAHREN_TAGE * 86400000).toISOString());
  return { ok: true, start: wall(start), pv_kwh: r1(pvKwh), heiz_kwh: r1(erg.heizKwh), netz_kwh: r1(erg.netzKwh),
           nachfuehrung: f, jetzt: jetzt.filter(j => j.plan_heizt || j.steuerung_heizt).map(j => `${j.name}: Planer ${j.plan_heizt ? 'heizt' : '–'}, Steuerung ${j.steuerung_heizt ? 'heizt' : '–'}`) };
}

async function lernen(sb: any, raumId: string, tage: number) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: tage });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const a = aufbereiten(d);
  const r = d.raeume.find((x: any) => x.id === raumId);
  if (!r) throw new Error(`Raum ${raumId} unbekannt`);
  const wins = fensterFuer(a, raumId, 6, 24);
  if (wins.length < 4) return { ok: false, raum: r.name, grund: `zu wenig Daten (${wins.length} Fenster)` };
  const heizStd = [...(a.smp.get(raumId)?.values() ?? [])].reduce((s, x) => s + x.h, 0) / 4;
  // Prior: Median der Räume mit viel eigener Heizerfahrung (aus den gespeicherten Modellen)
  const gute = Object.entries(d.modell ?? {}).filter(([id, m]: any) => id !== raumId && !m.prior && Number(m.heiz_std) >= 15).map(([, m]: any) => m.param as RaumParam);
  const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const prior: RaumParam = gute.length >= 2
    ? { k: med(gute.map(p => p.k)), g: med(gute.map(p => p.g)), s: 0, c: med(gute.map(p => p.c)), tau: med(gute.map(p => p.tau)) }
    : STANDARD_PARAM;
  const pw = heizStd >= 15 ? 0 : heizStd >= 3 ? 0.02 : 0.2;
  const p = lerneRaum(wins, prior, pw, [0, 1, 2]);
  const fe = prognoseFehler(p, fensterFuer(a, raumId, 3, 12), 47);
  const zeile = { room_id: raumId, raum: r.name, param: { k: +p.k.toFixed(5), g: +p.g.toFixed(4), s: +p.s.toFixed(4), c: +p.c.toFixed(4), tau: p.tau },
    fehler_12h: Number.isFinite(fe.modell) ? +fe.modell.toFixed(2) : null, gleich_12h: Number.isFinite(fe.gleich) ? +fe.gleich.toFixed(2) : null,
    heiz_std: +heizStd.toFixed(1), prior: pw > 0, tage, gelernt_at: new Date().toISOString() };
  const { error: upErr } = await sb.from('heizmodell').upsert(zeile, { onConflict: 'room_id' });
  if (upErr) throw new Error(`heizmodell: ${upErr.message}`);
  return { ok: true, ...zeile, fenster: wins.length };
}

async function pvLernen(sb: any, tage: number) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: tage });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const a = aufbereiten(d);
  // nur vergangene Stunden mit gemessener PV
  const coef = lernePv(a.pvIst, new Map([...a.wet].filter(([k]) => a.pvIst.has(k))));
  await sb.from('system_settings').upsert({ key: 'planer_pv_modell', value: { coef, tage, gelernt_at: new Date().toISOString() },
    updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return { ok: true, stunden: Object.keys(coef).length };
}

async function vergleich(sb: any, tag: string) {
  const { data: d, error } = await sb.rpc('heizplaner_daten', { p_tage: 3 });
  if (error) throw new Error(`heizplaner_daten: ${error.message}`);
  const a = aufbereiten(d);
  const g0 = mitternacht(tag);
  const pvEcht = (ep: number) => a.e15.get(ep)?.[2] ?? 0;
  const T0 = (r: any) => a.smp.get(r.id)?.get(g0)?.t ?? null;
  const b = baue(d, a, g0, pvEcht, T0);
  if (b.raeume.length === 0) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  const bat = batterieVon(d, letzterSoc(a, g0));
  const g = gewichte(d.settings);
  const heizIst = b.raeume.map(r => b.eps.map(ep => a.smp.get(r.id)?.get(ep)?.h ?? 0));
  const eIst = bewerte(b.raeume, b.slots, bat, g, heizIst);
  const ePlan = plane(b.raeume, b.slots, bat, g);
  // Planer bei gleichem Komfort wie die Steuerung: Komfort-Gewicht skalieren (Bisektion, logarithmisch)
  let lo = 0.02, hi = 4, gleich: any = null;
  for (let it = 0; it < 6; it++) {
    const m = Math.sqrt(lo * hi);
    const e = plane(b.raeume, b.slots, bat, { ...g, ziel: g.ziel * m, unter: g.unter * m });
    if (e.komfortGradStd > eIst.komfortGradStd) lo = m; else { hi = m; gleich = { m, e }; }
  }
  // Modellprüfung: Simulation mit echter Heizung gegen gemessene Temperaturen
  let abw = 0, n = 0;
  b.raeume.forEach((r, i) => b.eps.forEach((ep, j) => { const t = a.smp.get(r.id)?.get(ep + 900)?.t; if (t != null) { abw += Math.abs(eIst.temp[i][j] - t); n++; } }));
  const netzGem = b.eps.reduce((s, ep) => s + Math.max(0, a.e15.get(ep)?.[4] ?? 0), 0) / 4000;
  const kurz = (e: any) => ({ heiz_kwh: r1(e.heizKwh), netz_kwh: r1(e.netzKwh), einspeis_kwh: r1(e.einspeisKwh),
    unter_ziel_gradstd: r1(e.komfortGradStd), unter_grenze_gradstd: r1(e.unterGradStd) });
  const zeile = { tag, netz_gemessen_kwh: r1(netzGem), steuerung: kurz(eIst), planer: kurz(ePlan),
    planer_gleich: gleich ? { ...kurz(gleich.e), faktor: Math.round(gleich.m * 100) / 100 } : null,
    modell_abw: n ? Math.round(abw / n * 100) / 100 : null, erstellt_at: new Date().toISOString() };
  const { error: upErr } = await sb.from('heizplan_vergleich').upsert(zeile, { onConflict: 'tag' });
  if (upErr) throw new Error(`heizplan_vergleich: ${upErr.message}`);
  return { ok: true, ...zeile };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!await authorize(req)) return json({ error: 'Unauthorized' }, 401);
  try {
    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch { /* ohne Body */ }
    const aktion = body.aktion ?? url.searchParams.get('aktion') ?? 'planen';
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const gestern = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    let res: unknown;
    if (aktion === 'planen') res = await planen(sb);
    else if (aktion === 'lernen') res = await lernen(sb, body.raum ?? url.searchParams.get('raum'), Number(body.tage ?? url.searchParams.get('tage')) || 30);
    else if (aktion === 'pv_lernen') res = await pvLernen(sb, Number(body.tage ?? url.searchParams.get('tage')) || 30);
    else if (aktion === 'vergleich') res = await vergleich(sb, body.tag ?? url.searchParams.get('tag') ?? gestern);
    else return json({ error: `unbekannte aktion ${aktion}` }, 400);
    console.log(`[HEIZPLANER] ${aktion}: ${JSON.stringify(res).slice(0, 400)}`);
    return json(res);
  } catch (e) {
    console.error('heizplaner:', e);
    return json({ error: String(e) }, 500);
  }
});
