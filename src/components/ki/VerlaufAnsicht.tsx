// Verlauf und Wirkung (12.11.2026) – gleiche Darstellung wie KI › Planer, aber für die Vergangenheit.
// Uli: „PV-Produktion und Verbrauch, % Eigennutzung, Batterie Ladung und Verbrauch, Netzstrom, Auto und Warmwasser,
// Hausstrom, Optimierung über Zeit, KI-Vorschläge im Zeitstrahl genehmigt und Erfolg dieser Anpassung.“ –
// „Tag, Woche, Monat, Jahr, Vergleich Vorwoche, Vormonat, Vorjahr.“ – „Ich möchte die Kosten sehen für den Netzbezug.“
// Reine Anzeige (Daten als Props). Laden: VerlaufView.tsx. Daten: energie_stunde / energie_tag (SQL 35).
import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACHSE, FARBEN, Kachel, TIP, TZ, num } from './planerTeile';

export type Periode = 'tag' | 'woche' | 'monat' | 'jahr';
export type Vergleich = 'vor' | 'vorjahr' | 'aus';
export type EStunde = { stunde: string; pv_kwh: number; verbrauch_kwh: number; heizung_kwh: number | null; netz_kwh: number; einspeisung_kwh: number; soc_ende: number | null };
export type ETag = {
  tag: string; pv_kwh: number | null; verbrauch_kwh: number | null; heizung_kwh: number | null; haus_kwh: number | null; rest_kwh: number | null;
  netz_kwh: number | null; einspeisung_kwh: number | null; batt_laden_kwh: number | null; batt_entladen_kwh: number | null; netz_batt_leer_kwh: number | null;
  soc_min: number | null; soc_max: number | null; raum_h_unter_eco: number | null; planer_netz_kwh: number | null;
  netz_kosten_eur: number | null; einspeise_erloes_eur: number | null; stunden: number;
};
export type KiVorschlag = { ts: number; titel: string; wert: string };

const BATT_KWH = 13.8;
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const n0 = (x: number | null | undefined) => Number(x ?? 0);
export const tagLokal = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
const stundeLokal = (ms: number) => Number(new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }));
const tm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const mittel = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** Summen eines Zeitraums aus Tageswerten. */
function summen(t: ETag[]) {
  const s = (k: keyof ETag) => t.reduce((a, d) => a + n0(d[k] as number | null), 0);
  const eco = t.filter(d => d.raum_h_unter_eco != null);
  const plan = t.filter(d => d.planer_netz_kwh != null);
  return {
    pv: s('pv_kwh'), verbr: s('verbrauch_kwh'), heiz: s('heizung_kwh'), haus: s('haus_kwh'), rest: s('rest_kwh'),
    netz: s('netz_kwh'), einsp: s('einspeisung_kwh'), lad: s('batt_laden_kwh'), ent: s('batt_entladen_kwh'), leer: s('netz_batt_leer_kwh'),
    kosten: s('netz_kosten_eur'), erloes: s('einspeise_erloes_eur'),
    eco: eco.length ? eco.reduce((a, d) => a + n0(d.raum_h_unter_eco), 0) / eco.length : null,
    planNetz: plan.reduce((a, d) => a + n0(d.planer_netz_kwh), 0), planIst: plan.reduce((a, d) => a + n0(d.netz_kwh), 0), planTage: plan.length,
    tage: t.reduce((a, d) => a + Math.min(24, d.stunden) / 24, 0),   // halbe Tage (heute) zählen anteilig
  };
}

/** Unterschied zur Vergleichsperiode als Text, „besser“ je nach Richtung. */
function delta(a: number | null, b: number | null, wenigerBesser: boolean, einheit = '%') {
  if (a == null || b == null || b === 0) return null;
  const p = (a - b) / Math.abs(b) * 100;
  const gut = wenigerBesser ? p < 0 : p > 0;
  return { text: `${p > 0 ? '+' : ''}${num(p, 0)} ${einheit}`, gut };
}

function KachelV({ k, v, s, d, vglName }: { k: string; v: string; s?: string; d: ReturnType<typeof delta>; vglName: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-xl font-bold font-mono">{v}</div>
      {s && <div className="text-xs text-muted-foreground">{s}</div>}
      {d && <div className={`text-xs font-mono font-semibold ${d.gut ? 'text-success' : 'text-destructive'}`}>{d.text} <span className="font-normal text-muted-foreground">je Tag gegenüber {vglName}</span></div>}
    </div>
  );
}

export function VerlaufAnsicht(p: {
  periode: Periode; setPeriode: (x: Periode) => void; titel: string; zurueck: () => void; vor: (() => void) | null;
  vergleich: Vergleich; setVergleich: (x: Vergleich) => void; vglTitel: string;
  stunden: EStunde[]; vglStunden: EStunde[]; tage: ETag[]; vglTage: ETag[]; alleTage: ETag[]; vorschlaege: KiVorschlag[]; vonMs: number; bisMs: number; vglVonMs: number | null;
}) {
  const { periode, vergleich } = p;
  const stuendlich = periode === 'tag' || periode === 'woche';
  const s = useMemo(() => summen(p.tage), [p.tage]);
  const sv = useMemo(() => (vergleich === 'aus' ? null : summen(p.vglTage)), [p.vglTage, vergleich]);
  const vglName = vergleich === 'vorjahr' ? 'Vorjahr' : ({ tag: 'Vortag', woche: 'Vorwoche', monat: 'Vormonat', jahr: 'Vorjahr' } as const)[periode];
  // Vergleich je Tag (Mittel), damit unterschiedlich lange oder unvollständige Zeiträume vergleichbar sind.
  // Haus unter Eco ist schon ein Tagesmittel.
  const d = (a: number | null, b: number | null | undefined, weniger: boolean, schonJeTag = false) =>
    (sv && b != null && sv.tage > 0 && s.tage > 0 ? delta(a == null ? null : schonJeTag ? a : a / s.tage, schonJeTag ? b : b / sv.tage, weniger) : null);

  // Punkte der Grafik: Tag/Woche je Stunde, Monat je Tag, Jahr je Monat – immer der ganze Zeitraum.
  // Vergleich nach Position im Zeitraum ausgerichtet (gleiche Stunde der Woche, gleicher Tag im Monat, gleicher Monat).
  const punkte = useMemo(() => {
    const leer = { pv: null, heiz: null, rest: null, verbr: null, netz: null, bat: null, lad: null, ent: null, kosten: null, eco: null, plan: null,
      vglNetz: null, vglPv: null, vglKosten: null, vglEco: null } as Record<string, number | null>;
    if (stuendlich) {
      const n = Math.round((p.bisMs - p.vonMs) / 3600_000);
      const pos = (x: EStunde, von: number) => Math.round((Date.parse(x.stunde) - von) / 3600_000);
      const pts = Array.from({ length: n }, (_, i) => {
        const ms = p.vonMs + i * 3600_000;
        const wt = new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', timeZone: TZ }).replace('.', '');
        return { i, ms, label: periode === 'tag' ? `${String(stundeLokal(ms)).padStart(2, '0')}:00` : `${wt} ${String(stundeLokal(ms)).padStart(2, '0')}`, ...leer };
      });
      p.stunden.forEach(x => {
        const pt = pts[pos(x, p.vonMs)];
        if (!pt) return;
        Object.assign(pt, { pv: n0(x.pv_kwh), heiz: x.heizung_kwh, rest: x.heizung_kwh == null ? null : Math.max(0, n0(x.verbrauch_kwh) - n0(x.heizung_kwh)),
          verbr: n0(x.verbrauch_kwh), netz: n0(x.netz_kwh), bat: x.soc_ende == null ? null : Math.round(x.soc_ende * BATT_KWH) / 100 });
      });
      if (p.vglStunden.length && p.vglVonMs != null) p.vglStunden.forEach(x => {
        const pt = pts[pos(x, p.vglVonMs as number)];
        if (pt) Object.assign(pt, { vglNetz: n0(x.netz_kwh), vglPv: n0(x.pv_kwh) });
      });
      return pts;
    }
    const jahr = periode === 'jahr';
    const vonTag = tagLokal(p.vonMs);
    const n = jahr ? 12 : Math.round((p.bisMs - p.vonMs) / 86400_000);
    const pts = Array.from({ length: n }, (_, i) => {
      const ms = jahr ? Date.parse(`${vonTag.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-15T12:00:00Z`) : p.vonMs + i * 86400_000 + 12 * 3600_000;
      return { i, ms, label: jahr ? MONATE[i] : tm(tagLokal(ms)), ...leer };
    });
    const posT = (tag: string) => (jahr ? Number(tag.slice(5, 7)) - 1 : Number(tag.slice(8, 10)) - 1);
    const gruppen = (t: ETag[]) => { const m = new Map<number, ETag[]>(); t.forEach(x => m.set(posT(x.tag), [...(m.get(posT(x.tag)) ?? []), x])); return m; };
    gruppen(p.tage).forEach((rows, i) => {
      const su = summen(rows), pt = pts[i];
      if (pt) Object.assign(pt, { pv: su.pv, heiz: su.heiz, rest: su.rest + su.haus, verbr: su.verbr, netz: su.netz, lad: su.lad, ent: su.ent,
        kosten: su.kosten, eco: su.eco, plan: su.planTage ? su.planNetz : null });
    });
    gruppen(p.vglTage).forEach((rows, i) => {
      const su = summen(rows), pt = pts[i];
      if (pt) Object.assign(pt, { vglNetz: su.netz, vglPv: su.pv, vglKosten: su.kosten, vglEco: su.eco });
    });
    return pts;
  }, [p.stunden, p.vglStunden, p.tage, p.vglTage, p.vonMs, p.bisMs, p.vglVonMs, periode, stuendlich]);

  // KI-Marken: nächster Punkt je Genehmigung (Genehmigungen innerhalb eines Punktes teilen sich die Marke)
  const nummeriert = p.vorschlaege.map((x, i) => ({ ...x, n: i + 1 }));
  const imZeitraum = nummeriert.filter(x => x.ts * 1000 >= p.vonMs && x.ts * 1000 < p.bisMs);
  const marken = useMemo(() => {
    const m = new Map<number, number[]>();
    imZeitraum.forEach(x => {
      let best = 0, bestD = Infinity;
      punkte.forEach(pt => { const dd = Math.abs(pt.ms - x.ts * 1000); if (dd < bestD) { bestD = dd; best = pt.i; } });
      m.set(best, [...(m.get(best) ?? []), x.n]);
    });
    return [...m.entries()].map(([i, n]) => ({ i, n }));
  }, [imZeitraum, punkte]);
  const markenLinien = (oben: boolean) => marken.map(m => (
    <ReferenceLine key={m.n.join('+')} x={m.i} stroke="var(--c-ki)" strokeDasharray="4 3" strokeWidth={1.5}
      label={oben ? { value: `▼${m.n.join('+')}`, position: 'top', fill: 'var(--c-ki)', fontSize: 12, fontWeight: 700 } : undefined} />
  ));
  const tickJede = periode === 'tag' ? 2 : periode === 'woche' ? 11 : periode === 'monat' ? 2 : 0;
  const xAchse = <XAxis dataKey="i" type="number" domain={[-0.5, Math.max(0, punkte.length - 0.5)]} ticks={punkte.filter((_, i) => i % (tickJede + 1) === 0).map(x => x.i)}
    tickFormatter={(i: number) => punkte[i]?.label ?? ''} tick={ACHSE} tickLine={false} axisLine={false} />;
  const tipLabel = (i: number) => punkte[i]?.label ?? '';
  const einheit = stuendlich ? 'kW' : 'kWh';

  // Wirkung je KI-Vorschlag: 3 Tage vorher → 3 Tage nachher (Genehmigungstag zählt nicht) – unabhängig vom Zeitraum
  const wirkung = nummeriert.map(x => {
    const d0 = tagLokal(x.ts * 1000);
    const i = p.alleTage.findIndex(t => t.tag === d0);
    const vor = i < 0 ? [] : p.alleTage.slice(Math.max(0, i - 3), i);
    const nach = i < 0 ? [] : p.alleTage.slice(i + 1, i + 4).filter(t => t.stunden >= 23);
    const gleich = nummeriert.find(y => y.n < x.n && tagLokal(y.ts * 1000) === d0);
    const w = (f: (t: ETag) => number | null) => [mittel(vor.map(f)), mittel(nach.map(f))] as const;
    return { ...x, nTage: nach.length, gleich: gleich?.n ?? null, netz: w(t => t.netz_kwh), eco: w(t => t.raum_h_unter_eco), leer: w(t => t.netz_batt_leer_kwh), kosten: w(t => t.netz_kosten_eur) };
  }).filter(x => x.ts * 1000 < p.bisMs).reverse();
  const pfeil = ([a, b]: readonly [number | null, number | null], e: string, dz = 1) => (a == null || b == null ? '–' : `${num(a, dz)} → ${num(b, dz)} ${e}`);
  const besser = ([a, b]: readonly [number | null, number | null]) => (a == null || b == null ? null : b < a);
  const farbe = (x: boolean | null) => (x == null ? '' : x ? 'text-success' : 'text-destructive');

  const Knopf = ({ an, onClick, children }: { an: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} aria-pressed={an} className={`px-3 py-1 rounded-full border text-xs font-medium ${an ? 'bg-foreground text-background' : ''}`}>{children}</button>
  );

  return (
    <div className={`space-y-4 ${FARBEN}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(['tag', 'woche', 'monat', 'jahr'] as Periode[]).map(x => <Knopf key={x} an={periode === x} onClick={() => p.setPeriode(x)}>{{ tag: 'Tag', woche: 'Woche', monat: 'Monat', jahr: 'Jahr' }[x]}</Knopf>)}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={p.zurueck} aria-label="Zeitraum zurück" className="px-2 py-1 rounded border">◀</button>
          <span className="font-semibold min-w-[11rem] text-center">{p.titel}</span>
          <button type="button" onClick={p.vor ?? undefined} disabled={!p.vor} aria-label="Zeitraum vor" className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Vergleich:</span>
          <Knopf an={vergleich === 'vor'} onClick={() => p.setVergleich('vor')}>{({ tag: 'Vortag', woche: 'Vorwoche', monat: 'Vormonat', jahr: 'Vorjahr' } as const)[periode]}</Knopf>
          {periode !== 'jahr' && <Knopf an={vergleich === 'vorjahr'} onClick={() => p.setVergleich('vorjahr')}>Vorjahr</Knopf>}
          <Knopf an={vergleich === 'aus'} onClick={() => p.setVergleich('aus')}>aus</Knopf>
        </div>
      </div>
      {sv && <div className="text-xs text-muted-foreground">Vergleich mit {p.vglTitel}{sv.tage === 0 ? ' – dafür gibt es noch keine Daten (Ablage seit 13.10.2026)' : sv.tage < s.tage ? ` – dort nur ${sv.tage} Tage vorhanden` : ''}. Prozent = Unterschied je Tag. Grau gestrichelt in den Grafiken.</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KachelV k="PV" v={`${num(s.pv, 0)} kWh`} s={`Eigennutzung ${num(s.pv ? (s.pv - s.einsp) / s.pv * 100 : null)} % · ${num(s.einsp)} kWh eingespeist`} d={d(s.pv, sv?.pv, false)} vglName={vglName} />
        <KachelV k="Verbrauch" v={`${num(s.verbr, 0)} kWh`} s={`Heizung ${num(s.heiz, 0)} · Warmwasser+Auto ~${num(s.rest, 0)} · Haus ${num(s.haus, 0)}`} d={d(s.verbr, sv?.verbr, true)} vglName={vglName} />
        <KachelV k="Netz" v={`${num(s.netz, 0)} kWh`} s={`Autarkie ${num(s.verbr ? (s.verbr - s.netz) / s.verbr * 100 : null, 0)} %`} d={d(s.netz, sv?.netz, true)} vglName={vglName} />
        <KachelV k="Kosten Netz" v={`${num(s.kosten, 2)} €`} s={`Einspeisung +${num(s.erloes, 2)} € · netto ${num(s.kosten - s.erloes, 2)} €`} d={d(s.kosten, sv?.kosten, true)} vglName={vglName} />
        <KachelV k="Batterie" v={`${num(s.lad, 0)} / ${num(s.ent, 0)} kWh`} s={`geladen / entladen · ${num(s.lad / BATT_KWH)} Vollzyklen`} d={d(s.ent, sv?.ent, false)} vglName={vglName} />
        <KachelV k="Netz bei leerer Batterie" v={`${num(s.leer, 0)} kWh`} s="Ladestand ≤ 6 %" d={d(s.leer, sv?.leer, true)} vglName={vglName} />
        <KachelV k="Haus unter Eco" v={s.eco == null ? '–' : `${num(s.eco, 0)} Raum-h`} s="je Tag, 08–22 Uhr" d={d(s.eco, sv?.eco, true, true)} vglName={vglName} />
        <KachelV k="Planer bei gleicher Sonne" v={s.planTage ? `${num(s.planNetz, 0)} statt ${num(s.planIst, 0)} kWh` : '–'} s={s.planTage ? `${s.planTage} Tage mit Gegenrechnung · ${num(s.planIst ? (s.planNetz - s.planIst) / s.planIst * 100 : null, 0)} %` : 'noch keine Gegenrechnung'} d={null} vglName={vglName} />
      </div>

      <div>
        <div className="text-sm font-medium mb-1">{stuendlich ? 'Leistung (kW, Stundenmittel)' : periode === 'monat' ? 'Energie je Tag (kWh)' : 'Energie je Monat (kWh)'}</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={punkte} margin={{ top: 18, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              {xAchse}
              <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
              <Tooltip {...TIP} labelFormatter={tipLabel} formatter={(x: number, n: string) => [`${num(x)} ${einheit}`, n]} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              <Area type="stepAfter" dataKey="pv" name="PV-Produktion" stroke="var(--c-pv)" strokeWidth={1.5} fill="var(--c-pv)" fillOpacity={0.12} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="heiz" name="Heizung" stroke="var(--c-heiz)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="rest" name="Warmwasser, Auto, Haus" stroke="var(--c-rest)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="netz" name="Netzbezug" stroke="var(--c-netz)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              {sv && <Line type="stepAfter" dataKey="vglNetz" name={`Netz ${vglName}`} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              {sv && <Line type="stepAfter" dataKey="vglPv" name={`PV ${vglName}`} stroke="var(--c-pv)" strokeOpacity={0.5} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              {markenLinien(true)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-muted-foreground">Warmwasser, Auto und Haus = Verbrauch − Heizung, bis Wallbox- und Warmwasser-Werte gemessen werden. <span style={{ color: 'var(--c-ki)' }} className="font-bold">▼</span> = KI-Vorschlag genehmigt.</div>
      </div>

      <div>
        <div className="text-sm font-medium mb-1">{stuendlich ? 'Batterie-Ladung (kWh)' : 'Batterie: geladen und entladen (kWh)'}</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={punkte} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              {xAchse}
              <YAxis tick={ACHSE} tickLine={false} axisLine={false} domain={stuendlich ? [0, BATT_KWH] : [0, 'dataMax']} />
              <Tooltip {...TIP} labelFormatter={tipLabel} formatter={(x: number, n: string) => [`${num(x)} kWh`, n]} />
              {stuendlich
                ? <Line type="monotone" dataKey="bat" name="Batterie" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                : <>{[<Line key="l" type="stepAfter" dataKey="lad" name="geladen" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />,
                     <Line key="e" type="stepAfter" dataKey="ent" name="entladen" stroke="hsl(var(--primary))" strokeOpacity={0.5} strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false} />]}</>}
              {markenLinien(false)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!stuendlich && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Netzkosten (€) und Planer bei gleicher Sonne (kWh)</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={punkte} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                  {xAchse}
                  <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
                  <Tooltip {...TIP} labelFormatter={tipLabel} formatter={(x: number, n: string) => [n.includes('€') ? `${num(x, 2)} €` : `${num(x)} kWh`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                  <Line type="stepAfter" dataKey="kosten" name="Kosten €" stroke="var(--c-netz)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {sv && <Line type="stepAfter" dataKey="vglKosten" name={`Kosten € ${vglName}`} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                  <Line type="stepAfter" dataKey="netz" name="Netz kWh" stroke="var(--c-netz)" strokeOpacity={0.35} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey="plan" name="Planer kWh" stroke="var(--c-netz)" strokeOpacity={0.35} strokeDasharray="2 3" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                  {markenLinien(false)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Haus: Raum-Stunden unter Eco je Tag</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={punkte} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                  {xAchse}
                  <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
                  <Tooltip {...TIP} labelFormatter={tipLabel} formatter={(x: number, n: string) => [`${num(x, 0)} Raum-h`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                  <Line type="stepAfter" dataKey="eco" name="unter Eco" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  {sv && <Line type="stepAfter" dataKey="vglEco" name={vglName} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                  {markenLinien(false)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-muted-foreground">Weniger ist besser.</div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium">KI-Vorschläge: genehmigt und Wirkung (3 Tage vorher → 3 Tage nachher)</div>
        {wirkung.length === 0 ? <div className="text-sm text-muted-foreground">Bis zu diesem Zeitraum wurde kein Vorschlag genehmigt.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr><th className="py-1 pr-3 font-normal">Nr.</th><th className="pr-3 font-normal">genehmigt</th><th className="pr-3 font-normal">Vorschlag</th><th className="pr-3 font-normal">Netz je Tag</th><th className="pr-3 font-normal">Kosten je Tag</th><th className="pr-3 font-normal">Haus unter Eco</th><th className="pr-3 font-normal">Netz bei leerer Batterie</th><th className="font-normal">Urteil</th></tr>
              </thead>
              <tbody>
                {wirkung.map(w => {
                  const b = [besser(w.netz), besser(w.eco), besser(w.leer)];
                  const urteil = w.nTage === 0 ? 'zu früh' : w.gleich ? `nicht trennbar von Nr. ${w.gleich}` : w.nTage < 3 ? `vorläufig (${w.nTage} von 3 Tagen)`
                    : b.filter(x => x === true).length >= 2 ? 'besser' : b.filter(x => x === false).length >= 2 ? 'schlechter' : 'gemischt';
                  return (
                    <tr key={w.n} className="border-t align-top">
                      <td className="py-1 pr-3 font-bold" style={{ color: 'var(--c-ki)' }}>▼{w.n}</td>
                      <td className="pr-3 whitespace-nowrap">{new Date(w.ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })}</td>
                      <td className="pr-3">{w.titel}<br /><span className="text-xs text-muted-foreground font-mono">{w.wert}</span></td>
                      <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[0])}`}>{pfeil(w.netz, 'kWh')}</td>
                      <td className={`pr-3 font-mono whitespace-nowrap ${farbe(besser(w.kosten))}`}>{pfeil(w.kosten, '€', 2)}</td>
                      <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[1])}`}>{pfeil(w.eco, 'h', 0)}</td>
                      <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[2])}`}>{pfeil(w.leer, 'kWh')}</td>
                      <td className="text-muted-foreground">{urteil}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-xs text-muted-foreground">Grün = besser, rot = schlechter. Vorher/nachher hängt auch am Wetter – die Gegenrechnung des Planers (Netz bei gleicher Sonne) ist der fairere Vergleich.</div>
      </div>
    </div>
  );
}
