// Verlauf und Wirkung (12.11.2026) – gleiche Darstellung wie KI › Planer, aber für die vergangenen Tage.
// Uli: „PV-Produktion und Verbrauch, % Eigennutzung, Batterie Ladung und Verbrauch, Netzstrom, Auto und Warmwasser,
// Hausstrom, Optimierung über Zeit, KI-Vorschläge im Zeitstrahl genehmigt und Erfolg dieser Anpassung.“
// Reine Anzeige ohne Datenbank (Daten kommen als Props) – die Daten holt VerlaufView.tsx.
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACHSE, FARBEN, Kachel, TIP, TZ, num } from './planerTeile';

/** Stundenmittel in W (soc in %). ts = Stundenbeginn in Sekunden. heizung = „heizt“ × gemessene Raumleistung. */
export type VerlaufStunde = { ts: number; pv: number; verbrauch: number; heizung: number; netz: number; einsp: number; soc: number | null };
/** Tageswerte. planer = Netz in der Gegenrechnung des Planers, unterEco = Raum-Stunden unter Eco 08–22 Uhr. */
export type VerlaufTag = { tag: string; netz: number; planer: number | null; unterEco: number | null; netzBattLeer: number | null; batLad: number; batEnt: number };
export type VerlaufVorschlag = { ts: number; titel: string; wert: string };

const GRUNDLAST_W = 240;   // gemessen (raum_leistung_messung „Grundlast“)
const BATT_KWH = 13.8;
const tagLokal = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
const tm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const mittel = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

type Bereich = 'alles' | '7' | '30';

export function VerlaufAnsicht({ stunden, tage, vorschlaege }: { stunden: VerlaufStunde[]; tage: VerlaufTag[]; vorschlaege: VerlaufVorschlag[] }) {
  const [bereich, setBereich] = useState<Bereich>('alles');
  const ende = stunden.length ? stunden[stunden.length - 1].ts : 0;
  const ab = bereich === 'alles' ? 0 : ende - Number(bereich) * 86400;
  const h = useMemo(() => stunden.filter(s => s.ts >= ab), [stunden, ab]);
  const t = useMemo(() => tage.filter(d => d.tag >= tagLokal(ab * 1000)), [tage, ab]);
  const v = useMemo(() => vorschlaege.map((x, i) => ({ ...x, n: i + 1 })).filter(x => x.ts >= ab), [vorschlaege, ab]);

  // Summen (Stundenmittel W → kWh)
  const s = useMemo(() => {
    const k = (f: (x: VerlaufStunde) => number) => h.reduce((a, x) => a + f(x), 0) / 1000;
    const pv = k(x => x.pv), verbr = k(x => x.verbrauch), heiz = k(x => Math.min(x.heizung, x.verbrauch));
    const haus = k(x => Math.min(GRUNDLAST_W, Math.max(0, x.verbrauch - x.heizung)));
    const netz = k(x => x.netz), einsp = k(x => x.einsp);
    return { pv, verbr, heiz, haus, rest: Math.max(0, verbr - heiz - haus), netz, einsp,
      lad: t.reduce((a, d) => a + d.batLad, 0), ent: t.reduce((a, d) => a + d.batEnt, 0) };
  }, [h, t]);
  const eco = t.filter(d => d.unterEco != null);
  const plan = t.filter(d => d.planer != null);

  const daten = useMemo(() => h.map(x => ({
    ts: x.ts * 1000, pv: x.pv / 1000, heiz: Math.min(x.heizung, x.verbrauch) / 1000,
    rest: Math.max(0, x.verbrauch - x.heizung) / 1000, netz: x.netz / 1000,
    bat: x.soc == null ? null : Math.round(x.soc * BATT_KWH) / 100,
  })), [h]);
  const ticks = useMemo(() => {
    const tagSet = Array.from(new Set(daten.map(d => tagLokal(d.ts))));
    return tagSet.map(tg => daten.find(d => tagLokal(d.ts) === tg && new Date(d.ts).toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }) === '12')?.ts)
      .filter((x): x is number => x != null);
  }, [daten]);
  const tickTag = (ms: number) => tm(tagLokal(ms));
  const tagDaten = t.map(d => ({ ...d, x: tm(d.tag) }));

  // Wirkung je Vorschlag: 3 Tage vorher gegen 3 Tage nachher (Tag der Genehmigung zählt nicht)
  const wirkung = v.map(x => {
    const d0 = tagLokal(x.ts * 1000);
    const i = tage.findIndex(d => d.tag === d0);
    const vor = i < 0 ? [] : tage.slice(Math.max(0, i - 3), i);
    const nach = i < 0 ? [] : tage.slice(i + 1, i + 4);
    const gleich = v.find(y => y.n < x.n && tagLokal(y.ts * 1000) === d0);
    const w = (f: (d: VerlaufTag) => number | null) => [mittel(vor.map(f)), mittel(nach.map(f))] as const;
    return { ...x, tag: d0, nTage: nach.length, gleich: gleich?.n ?? null,
      netz: w(d => d.netz), eco: w(d => d.unterEco), leer: w(d => d.netzBattLeer) };
  });
  const pfeil = ([a, b]: readonly [number | null, number | null], einheit: string, d = 1) =>
    a == null || b == null ? '–' : `${num(a, d)} → ${num(b, d)} ${einheit}`;
  const besser = ([a, b]: readonly [number | null, number | null]) => (a == null || b == null ? null : b < a);

  // Recharts erkennt nur direkte Kinder – deshalb eine Funktion, die die Linien liefert, keine eigene Komponente.
  // Genehmigungen innerhalb von 6 h teilen sich eine Marke (z. B. „▼1+2“), sonst überlagern sich die Beschriftungen.
  const gruppen = v.reduce<{ ts: number; n: number[] }[]>((a, x) => {
    const g = a[a.length - 1];
    if (g && x.ts - g.ts < 6 * 3600) g.n.push(x.n); else a.push({ ts: x.ts, n: [x.n] });
    return a;
  }, []);
  const marken = (oben: boolean) => gruppen.map(g => (
    <ReferenceLine key={g.n.join('+')} x={g.ts * 1000} stroke="var(--c-ki)" strokeDasharray="4 3" strokeWidth={1.5} ifOverflow="extendDomain"
      label={oben ? { value: `▼${g.n.join('+')}`, position: 'top', fill: 'var(--c-ki)', fontSize: 12, fontWeight: 700 } : undefined} />
  ));

  return (
    <div className={`space-y-4 ${FARBEN}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          {([['alles', 'seit 01.11.'], ['7', '7 Tage'], ['30', '30 Tage']] as [Bereich, string][]).map(([id, l]) => (
            <button key={id} type="button" onClick={() => setBereich(id)} aria-pressed={bereich === id}
              className={`px-3 py-1 rounded-full border text-xs font-medium ${bereich === id ? 'bg-foreground text-background' : ''}`}>{l}</button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">gemessen · Stundenmittel · <span style={{ color: 'var(--c-ki)' }} className="font-bold">▼</span> KI-Vorschlag genehmigt</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kachel k="PV" v={`${num(s.pv, 0)} kWh`} s={`Eigennutzung ${num(s.pv ? (s.pv - s.einsp) / s.pv * 100 : null)} % · ${num(s.einsp)} kWh eingespeist`} />
        <Kachel k="Verbrauch" v={`${num(s.verbr, 0)} kWh`} s={`Heizung ${num(s.heiz, 0)} · Warmwasser+Auto ~${num(s.rest, 0)} · Haus ${num(s.haus, 0)}`} />
        <Kachel k="Netz" v={`${num(s.netz, 0)} kWh`} s={`Autarkie ${num(s.verbr ? (s.verbr - s.netz) / s.verbr * 100 : null, 0)} %${plan.length ? ` · Planer ${num(plan.reduce((a, d) => a + (d.planer ?? 0), 0), 0)} statt ${num(plan.reduce((a, d) => a + d.netz, 0), 0)} kWh` : ''}`} />
        <Kachel k="Batterie" v={`${num(s.lad, 0)} / ${num(s.ent, 0)} kWh`} s={`geladen / entladen · ${num(s.lad / BATT_KWH)} Vollzyklen`} />
        <Kachel k="Haus unter Eco" v={eco.length ? `${num(eco[0].unterEco, 0)} → ${num(eco[eco.length - 1].unterEco, 0)}` : '–'} s="Raum-Stunden je Tag, erster → letzter Tag" />
        <Kachel k="Netz bei leerer Batterie" v={`${num(t.reduce((a, d) => a + (d.netzBattLeer ?? 0), 0), 0)} kWh`} s="Ladestand ≤ 6 %" />
        <Kachel k="KI-Vorschläge" v={`${v.length} genehmigt`} s={`${wirkung.filter(w => w.nTage >= 3).length} mit 3 Tagen danach`} />
        <Kachel k="Zeitraum" v={`${t.length} Tage`} s={t.length ? `${tm(t[0].tag)}–${tm(t[t.length - 1].tag)}` : ''} />
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Leistung (kW)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daten} margin={{ top: 18, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks} interval={0} tickFormatter={tickTag} tick={ACHSE} tickLine={false} axisLine={false} />
              <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
              <Tooltip {...TIP} labelFormatter={(ms: number) => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })}
                formatter={(x: number, n: string) => [`${num(x)} kW`, n]} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              <Area type="stepAfter" dataKey="pv" name="PV-Produktion" stroke="var(--c-pv)" strokeWidth={1.5} fill="var(--c-pv)" fillOpacity={0.12} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="heiz" name="Heizung" stroke="var(--c-heiz)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="rest" name="Warmwasser, Auto, Haus" stroke="var(--c-rest)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="netz" name="Netzbezug" stroke="var(--c-netz)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              {marken(true)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-muted-foreground">Warmwasser, Auto und Haus = Verbrauch − Heizung, bis Wallbox- und Warmwasser-Werte gemessen werden.</div>
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Batterie-Ladung (kWh)</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daten} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks} interval={0} tickFormatter={tickTag} tick={ACHSE} tickLine={false} axisLine={false} />
              <YAxis tick={ACHSE} tickLine={false} axisLine={false} domain={[0, BATT_KWH]} />
              <Tooltip {...TIP} labelFormatter={(ms: number) => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })}
                formatter={(x: number) => [`${num(x)} kWh`, 'Batterie']} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
              <Line type="monotone" dataKey="bat" name="Batterie" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              {marken(false)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium mb-1">Netz je Tag: gemessen und Planer (kWh)</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={tagDaten} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="x" interval={0} tick={ACHSE} tickLine={false} axisLine={false} />
                <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
                <Tooltip {...TIP} formatter={(x: number, n: string) => [`${num(x)} kWh`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                <Line type="monotone" dataKey="netz" name="gemessen" stroke="var(--c-netz)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="planer" name="Planer bei gleicher Sonne" stroke="var(--c-netz)" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                {v.map(x => <ReferenceLine key={x.n} x={tm(tagLokal(x.ts * 1000))} stroke="var(--c-ki)" strokeDasharray="4 3" />)}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1">Haus: Raum-Stunden unter Eco je Tag</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tagDaten} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="x" interval={0} tick={ACHSE} tickLine={false} axisLine={false} />
                <YAxis tick={ACHSE} tickLine={false} axisLine={false} />
                <Tooltip {...TIP} formatter={(x: number) => [`${num(x, 0)} Raum-h`, 'unter Eco']} />
                <Line type="monotone" dataKey="unterEco" name="unter Eco" stroke="hsl(var(--foreground))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                {v.map(x => <ReferenceLine key={x.n} x={tm(tagLokal(x.ts * 1000))} stroke="var(--c-ki)" strokeDasharray="4 3" />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground">Weniger ist besser.</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">KI-Vorschläge: genehmigt und Wirkung (3 Tage vorher → 3 Tage nachher)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground text-left">
              <tr><th className="py-1 pr-3 font-normal">Nr.</th><th className="pr-3 font-normal">genehmigt</th><th className="pr-3 font-normal">Vorschlag</th><th className="pr-3 font-normal">Netz je Tag</th><th className="pr-3 font-normal">Haus unter Eco</th><th className="pr-3 font-normal">Netz bei leerer Batterie</th><th className="font-normal">Urteil</th></tr>
            </thead>
            <tbody>
              {wirkung.map(w => {
                const b = [besser(w.netz), besser(w.eco), besser(w.leer)];
                const urteil = w.nTage === 0 ? 'zu früh' : w.gleich ? `nicht trennbar von Nr. ${w.gleich}` : w.nTage < 3 ? `vorläufig (${w.nTage} von 3 Tagen)`
                  : b.filter(x => x === true).length >= 2 ? 'besser' : b.filter(x => x === false).length >= 2 ? 'schlechter' : 'gemischt';
                const farbe = (x: boolean | null) => (x == null ? '' : x ? 'text-success' : 'text-destructive');
                return (
                  <tr key={w.n} className="border-t align-top">
                    <td className="py-1 pr-3 font-bold" style={{ color: 'var(--c-ki)' }}>▼{w.n}</td>
                    <td className="pr-3 whitespace-nowrap">{new Date(w.ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })}</td>
                    <td className="pr-3">{w.titel}<br /><span className="text-xs text-muted-foreground font-mono">{w.wert}</span></td>
                    <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[0])}`}>{pfeil(w.netz, 'kWh')}</td>
                    <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[1])}`}>{pfeil(w.eco, 'h', 0)}</td>
                    <td className={`pr-3 font-mono whitespace-nowrap ${farbe(b[2])}`}>{pfeil(w.leer, 'kWh')}</td>
                    <td className="text-muted-foreground">{urteil}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-muted-foreground">Grün = besser, rot = schlechter. Vorher/nachher hängt auch am Wetter – die Gegenrechnung des Planers (Netz bei gleicher Sonne) ist der fairere Vergleich.</div>
      </div>
    </div>
  );
}
