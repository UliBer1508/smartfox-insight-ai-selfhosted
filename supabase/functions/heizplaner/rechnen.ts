// Heizplaner – Daten aufbereiten, lernen, planen, gegenrechnen (ohne Datenbank-Zugriff).
// Getrennt von index.ts, damit dieselben Funktionen für die Prüfung mit echten Daten genutzt werden können
// (doc/FIX-PLANER-MODELL-2026-11-13.md).
import {
  BLOCK, SLOTS, STANDARD_PARAM, aufheizen, bewerte, estrichStart, istV2, lernePv, lerneRaum, nachfuehrFaktor, plane,
  prognoseFehler, pvVorhersage,
  type Batterie, type Fenster, type Gewichte, type PlanRaum, type PlanSlot, type PvModell, type RaumParam,
} from './modell.ts';
import { neuerStand, pruefePlan, type Messwert, type PruefStand, type RaumPruefung } from './pruefung.ts';

export const PLAN_AUFBEWAHREN_TAGE = 3;

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
  messwerte?: Record<string, Messwert> | null;      // raum_messwerte (SQL 38)
  pruefung?: { stand?: PruefStand } | null;          // letzter Stand der Plan-Prüfung (system_settings planer_pruefung)
}
export function aufbereiten(d: Daten) {
  const wet = new Map<string, { dir: number; dif: number; t: number }>((d.wetter ?? []).map(w => [w[0], { dir: Number(w[1]) || 0, dif: Number(w[2]) || 0, t: Number(w[3]) }]));
  const e15 = new Map<number, number[]>((d.energie15 ?? []).map(r => [Number(r[0]), r.map(Number)]));
  const pvIst = new Map<string, number>((d.pv_h ?? []).map(r => [r[0], Number(r[1])]));
  const smp = new Map<string, Map<number, { t: number; h: number }>>();
  for (const [rid, arr] of Object.entries(d.samples15 ?? {})) smp.set(rid, new Map(arr.map(a => [Number(a[0]), { t: Number(a[1]), h: Number(a[2]) }])));
  return { wet, e15, pvIst, smp };
}
export type Aufb = ReturnType<typeof aufbereiten>;

export function fensterFuer(a: Aufb, rid: string, alleH: number, laengeH: number): Fenster[] {
  const m = a.smp.get(rid);
  if (!m) return [];
  const out: Fenster[] = [];
  for (const t0 of [...m.keys()].sort((x, y) => x - y)) {
    if (t0 % (alleH * 3600) !== 0) continue;
    const st = Array.from({ length: laengeH * 4 }, (_, i) => t0 + 900 * i);
    if (!st.every(x => m.has(x) && a.e15.has(x) && a.wet.has(wkey(x)))) continue;
    const T0 = m.get(t0)!.t;
    const hz = Array.from({ length: 48 }, (_, i) => t0 - 900 * (48 - i));
    out.push({
      T0,
      histT: hz.map(x => m.get(x)?.t ?? T0), histH: hz.map(x => m.get(x)?.h ?? 0),
      h: st.map(x => m.get(x)!.h), tout: st.map(x => a.wet.get(wkey(x))!.t),
      pvkw: st.map(x => a.e15.get(x)![2] / 1000),
      tIst: st.map(x => m.get(x + 900)?.t ?? null),
    });
  }
  return out;
}

export function gewichte(s: any): Gewichte {
  const buy = Number(s?.electricity_price_kwh_cent) || 30, feed = Number(s?.feed_in_price_kwh_cent) || 8;
  return { ziel: Number(s?.planer_gewicht_ziel ?? 0.6), unter: Number(s?.planer_gewicht_unter ?? 2), sicher: 30, ueber: 0.2,   // sicher: unter Min – praktisch verboten (seit 14.11.2026 ohne Abstand)
           einspeiseFaktor: Math.min(1, feed / buy), batterieRest: 0.9,
           // 13.11.2026: Wärme im Estrich am Planende zählt wie Restladung der Batterie – sonst „spart“ der Plan, indem er
           // den Wärmespeicher des Hauses leert (Gegenrechnung 12.11.: 12,8 statt 40,9 kWh Heizen bei wärmeren Räumen).
           waermeRest: 0.9,
           // 13.11.2026 abends: MEHR Wärme am Planende zählt nur wie PV-Strom, der sonst eingespeist würde (+ kleiner
           // Aufschlag). Mit 0,9 kostete Heizen aus dem Netz in den Estrich rechnerisch nur 10 % – der Plan heizte den
           // Wirtschaftsraum 23 h und das Wohnzimmer aus dem Netz über das Ziel (doc/FIX-PLANER-PRUEFUNG-2026-11-13.md).
           waermeMehr: Math.min(0.9, Math.min(1, feed / buy) + 0.05) };
}

/** Räume und Slots für einen Plan ab `start` aufbauen. pvVon(ep) liefert die PV je Slot (W). */
export function baue(d: Daten, a: Aufb, start: number, pvVon: (ep: number, i: number) => number,
              T0: (r: any) => number | null, festVon?: (r: any, ep: number, i: number) => 0 | 1 | null,
              abwesend?: (ep: number) => boolean) {
  const s = d.settings ?? {};
  const ns = minuten(s.night_start_time, '22:00'), ne = minuten(s.night_end_time, '08:00');
  const base = Number(d.grundlast) || 240;
  const cap = Math.max(0, Number(s.max_grid_heating_power_w ?? 2000));
  // 14.11.2026 (Uli): Min ist die Untergrenze, kein Wert darunter. Der Planer hält Min praktisch hart (Strafe `sicher`
  // ab Min statt ab Min − planer_sicherheit_abstand). Vorlauf und Min-Deckel braucht er nicht: Nachrechnung 14.11. –
  // gleiche Temperaturen, aber 2–5 kWh mehr Netz am Tag (doc/FIX-PLANER-MIN-HART-2026-11-14.md). Beides gilt nur in der
  // Regel-Steuerung (Rückfall).
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
    const gespeichert = d.modell?.[r.id]?.param;
    const param: RaumParam = istV2(gespeichert) ? gespeichert : STANDARD_PARAM;   // altes Modell → bis zum nächsten Lernen Standard
    const m = a.smp.get(r.id);
    const hz = Array.from({ length: 48 }, (_, i) => start - 900 * (48 - i));
    const S0 = estrichStart(param, hz.map(x => m?.get(x)?.t ?? t0), hz.map(x => m?.get(x)?.h ?? 0), t0);
    const eco = Number(r.eco ?? s.eco_temp ?? 21);
    const unter = Number(r.unter ?? eco - 1.5);
    const nachtZiel = Math.max(Number(r.nacht ?? s.night_temp ?? unter), unter);
    raeume.push({
      id: r.id, name: r.name, p: Number(r.p) || 800, T0: t0, S0, param,
      // Abwesend (Kalender, wie pv-automation „jeder Tag ein Wartetag“): tagsüber Ziel = Untergrenze; PV-Überschuss
      // darf trotzdem bis Komfort laden (das entscheidet die Rechnung über den Einspeisewert).
      ziel: nacht.map((n, i) => (n ? nachtZiel : (abwesend?.(eps[i]) ? unter : eco))), unter: eps.map(() => unter), sicher: eps.map(() => unter),
      max: eps.map(() => Number(r.komfort ?? eco + 1)),   // 07.11.2026: Komfort ist das Maximum (kein eigener Estrich-Wert mehr)
      gewicht: 1 + (12 - (Number(r.prio) || 12)) / 12,
      fest: eps.map((ep, i) => (festVon ? festVon(r, ep, i) : null)),
    });
  }
  return { slots, raeume, eps, nacht };
}

export function batterieVon(d: Daten, socProzent: number): Batterie {
  const cap = Number(d.settings?.battery_capacity_kwh) || 13.8;
  return { eKwh: cap * socProzent / 100, capKwh: cap, minKwh: cap * 0.05, maxLadenW: 5500, maxEntladenW: 5700, eta: 0.95 };
}
export const letzterSoc = (a: Aufb, bis: number) => { let best = -1, soc = 50; for (const [k, v] of a.e15) if (k <= bis && k > best) { best = k; soc = v[3]; } return soc; };
export const r1 = (x: number) => Math.round(x * 10) / 10;

/** Plan rechnen ohne Schreiben (auch für die Prüfung). */
/** Abwesenheiten (presence_periods) als Zeiträume [von, bis − Vorlauf] in Epoch-Sekunden. */
export type Abwesenheit = [number, number][];
export function planAus(d: Daten, nichtSteuerbar: Set<string>, abw: Abwesenheit = []) {
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
    if (nichtSteuerbar.has(r.id)) return r.heizt ? 1 : 0;                                                  // nimmt keine Befehle an
    if (r.manuell_bis && new Date(r.manuell_bis).getTime() > ep * 1000) return r.heizt ? 1 : 0;          // manuell: so lassen
    // Plan-Prüfung (13.11.2026): auffälliger Raum – die Regel-Steuerung heizt ihn bis zum Ende der Sperre; der Plan rechnet
    // mit seinem jetzigen Zustand (wie bei „nicht steuerbar“), damit Leistungsgrenze und Batterie stimmen.
    const sp = d.pruefung?.stand?.[r.id];
    if (sp && sp.bis > ep) return r.heizt ? 1 : 0;
    return null;
  };
  const abwesend = (ep: number) => abw.some(([v, b]) => ep >= v && ep < b);
  const { slots, raeume, eps } = baue(d, a, start, pvVon, r => (r.t == null ? null : Number(r.t)), fest, abwesend);
  const bat = batterieVon(d, letzterSoc(a, d.jetzt));
  const g = gewichte(d.settings);
  const erg = plane(raeume, slots, bat, g);
  // Plan-Prüfung je Raum gegen die Messwerte (13.11.2026): auffällige Räume steuert die Regel-Steuerung
  const pruefung: Record<string, RaumPruefung> = d.messwerte
    ? pruefePlan(raeume, erg.heizen, erg.temp, slots, erg.heizW, d.messwerte, d.pruefung?.stand, d.jetzt)
    : {};
  const stand = neuerStand(pruefung, d.pruefung?.stand, d.jetzt);

  const jetzt = raeume.map((r, i) => {
    const room = d.raeume.find((x: any) => x.id === r.id);
    const planHeizt = erg.heizen[i][0] === 1;
    // nächster Heizbeginn / Heizende im Plan
    const naechstAn = erg.heizen[i].findIndex(v => v === 1);
    const naechstAus = planHeizt ? erg.heizen[i].findIndex(v => v === 0) : -1;
    return {
      room_id: r.id, name: r.name, t: r.T0, plan_heizt: planHeizt, steuerung_heizt: !!room?.heizt,
      manuell: !!(room?.manuell_bis && new Date(room.manuell_bis).getTime() > jetztMs), auto: room?.auto !== false,
      nicht_steuerbar: nichtSteuerbar.has(r.id), ziel: r1(r.ziel[0]), unter: r1(r.unter[0]),
      naechst_an: naechstAn >= 0 ? new Date(eps[naechstAn] * 1000).toISOString() : null,
      bis: naechstAus > 0 ? new Date(eps[naechstAus] * 1000).toISOString() : null,
      t_min: r1(Math.min(...erg.temp[i])), t_max: r1(Math.max(...erg.temp[i])),
      pruefung_ok: pruefung[r.id]?.ok ?? true, pruefung: pruefung[r.id]?.gruende ?? [], hinweis: pruefung[r.id]?.hinweis ?? null,
      geplant_h: pruefung[r.id]?.geplant_h ?? null, erlaubt_h: pruefung[r.id]?.erlaubt_h ?? null,
    };
  });
  const plan = {
    start, slot_min: 15, block: BLOCK,
    pv: slots.map(s => Math.round(s.pv)), heiz: erg.heizW.map(Math.round), netz: erg.netzW.map(Math.round),
    einsp: erg.einspeisW.map(Math.round), bat: erg.batKwh.map(r1), tout: slots.map(s => r1(s.tout)),
    raeume: raeume.map((r, i) => ({ id: r.id, name: r.name, p: r.p, h: erg.heizen[i].join(''), t: erg.temp[i].map(r1),
      ziel: r.ziel.map(r1), unter: r1(r.unter[0]),
      // m2: Raummodell der neuen Form gelernt (13.11.2026). Ohne (Standardwerte) setzt pv-automation den Plan nicht um.
      m2: istV2(d.modell?.[r.id]?.param),
      // Plan-Prüfung (13.11.2026): false → pv-automation steuert diesen Raum nach dem Regelwerk, nicht nach dem Plan
      pruefung_ok: pruefung[r.id]?.ok ?? true })),
    gewichte: g, batterie_start: r1(bat.eKwh), schritte: erg.schritte, waerme_kwh: r1(erg.waermeKwh),
  };
  const pvKwh = slots.reduce((s, x) => s + x.pv, 0) / 4000;
  const zeile = {
    start_at: new Date(start * 1000).toISOString(), modus: d.settings?.planer_modus ?? 'schatten', plan, jetzt,
    pv_kwh: r1(pvKwh), heiz_kwh: r1(erg.heizKwh), netz_kwh: r1(erg.netzKwh), einspeis_kwh: r1(erg.einspeisKwh),
    unter_ziel_gradstd: r1(erg.komfortGradStd), unter_grenze_gradstd: r1(erg.unterGradStd), nachfuehrung: Math.round(f * 100) / 100,
  };
  const antwort = { ok: true, start: wall(start), pv_kwh: r1(pvKwh), heiz_kwh: r1(erg.heizKwh), netz_kwh: r1(erg.netzKwh),
           waerme_kwh: r1(erg.waermeKwh), nachfuehrung: f,
           jetzt: jetzt.filter(j => j.plan_heizt || j.steuerung_heizt).map(j => `${j.name}: Planer ${j.plan_heizt ? 'heizt' : '–'}, Steuerung ${j.steuerung_heizt ? 'heizt' : '–'}`) };
  return { zeile, antwort, erg, raeume, pruefung, stand };
}

/** Lernen ohne Schreiben (auch für die Prüfung „pruefen“). */
export function lerneAus(d: Daten, raumId: string, tage: number, priorVon?: Record<string, RaumParam>) {
  const a = aufbereiten(d);
  const r = d.raeume.find((x: any) => x.id === raumId);
  if (!r) throw new Error(`Raum ${raumId} unbekannt`);
  const wins = fensterFuer(a, raumId, 6, 24);
  if (wins.length < 4) return { ok: false as const, raum: r.name, grund: `zu wenig Daten (${wins.length} Fenster)` };
  const heizStd = [...(a.smp.get(raumId)?.values() ?? [])].reduce((s, x) => s + x.h, 0) / 4;
  // Prior: Median der Räume mit viel eigener Heizerfahrung (gespeicherte Modelle der neuen Form)
  const quelle: [string, { param: RaumParam; heiz_std: number; prior: boolean }][] = priorVon
    ? Object.entries(priorVon).map(([id, p]) => [id, { param: p, heiz_std: 99, prior: false }])
    : Object.entries(d.modell ?? {}) as any;
  const gute = quelle.filter(([id, m]) => id !== raumId && !m.prior && Number(m.heiz_std) >= 15 && istV2(m.param)).map(([, m]) => m.param);
  const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const prior: RaumParam = gute.length >= 2
    ? { v: 2, k: med(gute.map(p => p.k)), g: med(gute.map(p => p.g)), u: med(gute.map(p => p.u)),
        r: med(gute.map(p => p.r)), s: 0, c: med(gute.map(p => p.c)) }
    : STANDARD_PARAM;
  const pw = heizStd >= 15 ? 0 : heizStd >= 3 ? 0.02 : 0.2;
  const p = lerneRaum(wins, prior, pw);
  const fe = prognoseFehler(p, fensterFuer(a, raumId, 3, 12), 47);
  const rund = (x: number, n: number) => +x.toFixed(n);
  const zeile = {
    room_id: raumId, raum: r.name,
    param: { v: 2 as const, k: rund(p.k, 5), g: rund(p.g, 4), u: rund(p.u, 4), r: rund(p.r, 3), s: rund(p.s, 4), c: rund(p.c, 4),
             // zur Anzeige: Aufheizen von Estrich + Raum zusammen (°C/h)
             auf: rund(aufheizen(p), 3) },
    fehler_12h: Number.isFinite(fe.modell) ? +fe.modell.toFixed(2) : null, gleich_12h: Number.isFinite(fe.gleich) ? +fe.gleich.toFixed(2) : null,
    heiz_std: +heizStd.toFixed(1), prior: pw > 0, tage, gelernt_at: new Date().toISOString(),
  };
  return { ok: true as const, zeile, fenster: wins.length };
}

/** Gegenrechnung eines Tages ohne Schreiben. */
export function vergleichAus(d: Daten, tag: string, nichtSteuerbar: Set<string>): any {
  const a = aufbereiten(d);
  const g0 = mitternacht(tag);
  const pvEcht = (ep: number) => a.e15.get(ep)?.[2] ?? 0;
  const T0 = (r: any) => a.smp.get(r.id)?.get(g0)?.t ?? null;
  // Räume, die keine Befehle annehmen: auch im Plan so, wie sie wirklich geheizt haben
  const fest = (r: any, ep: number) => (nichtSteuerbar.has(r.id) ? ((a.smp.get(r.id)?.get(ep)?.h ?? 0) >= 0.5 ? 1 : 0) : null);
  const b = baue(d, a, g0, pvEcht, T0, fest);
  if (b.raeume.length === 0) return { ok: false, grund: 'keine Temperaturen um Mitternacht' };
  const bat = batterieVon(d, letzterSoc(a, g0));
  const g = gewichte(d.settings);
  const heizIst = b.raeume.map(r => b.eps.map(ep => a.smp.get(r.id)?.get(ep)?.h ?? 0));
  const eIst = bewerte(b.raeume, b.slots, bat, g, heizIst);
  const ePlan = plane(b.raeume, b.slots, bat, g);
  // Modellprüfung: Simulation mit echter Heizung gegen gemessene Temperaturen
  let abw = 0, n = 0;
  b.raeume.forEach((r, i) => b.eps.forEach((ep, j) => { const t = a.smp.get(r.id)?.get(ep + 900)?.t; if (t != null) { abw += Math.abs(eIst.temp[i][j] - t); n++; } }));
  const netzGem = b.eps.reduce((s, ep) => s + Math.max(0, a.e15.get(ep)?.[4] ?? 0), 0) / 4000;
  // waerme_kwh: gespeicherte Wärme am Tagesende gegenüber Mitternacht (Estrich + Luft). Ein Plan, der weniger heizt,
  // aber den Speicher leert, ist nicht besser – deshalb steht die Wärme dabei (13.11.2026).
  const kurz = (e: any) => ({ heiz_kwh: r1(e.heizKwh), netz_kwh: r1(e.netzKwh), einspeis_kwh: r1(e.einspeisKwh),
    unter_ziel_gradstd: r1(e.komfortGradStd), unter_grenze_gradstd: r1(e.unterGradStd), waerme_kwh: r1(e.waermeKwh) });
  // Fairer Vergleich (13.11.2026): Netz des Planers, bereinigt um die Wärme, die er am Tagesende mehr (oder weniger) im
  // Haus gespeichert hat als die Steuerung. Die frühere Spalte „Planer bei gleichem Komfort“ (Komfort-Gewicht skaliert)
  // entfällt: Mit dem Wert der Restwärme leerte sie den Estrich und war nicht mehr vergleichbar.
  const planer = { ...kurz(ePlan), netz_bereinigt_kwh: r1(ePlan.netzKwh - (ePlan.waermeKwh - eIst.waermeKwh)) };
  return { ok: true, tag, netz_gemessen_kwh: r1(netzGem), steuerung: kurz(eIst), planer,
    planer_gleich: null,
    modell_abw: n ? Math.round(abw / n * 100) / 100 : null, erstellt_at: new Date().toISOString() };
}


/** PV-Vorhersage je Stunde lernen – nur vergangene Stunden mit gemessener PV. */
export function pvLernenAus(d: Daten): PvModell {
  const a = aufbereiten(d);
  return lernePv(a.pvIst, new Map([...a.wet].filter(([k]) => a.pvIst.has(k))));
}
