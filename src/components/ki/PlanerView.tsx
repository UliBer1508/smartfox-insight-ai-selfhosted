// Planer (Schattenbetrieb) – 06.11.2026, doc/KONZEPT-PLANER-2026-11-06.md
// Zeigt, was der rechnende Planer (Edge Function heizplaner) tun würde, ohne dass er steuert:
//   1. Plan der nächsten 24 h: PV-Vorhersage, geplante Heizung, Netzbezug (eine Einheit, eine Achse) + Batterie
//   2. Jetzt: je Raum Planer vs. heutige Steuerung
//   3. Zeitleiste je Raum (halbe Stunden)
//   4. Gegenrechnung der Vortage: heutige Steuerung vs. Planer bei gleicher Sonne
//   5. Raummodell: was der Planer über jeden Raum gelernt hat und wie gut es stimmt
// Farben (geprüft mit dataviz/validate_palette, hell und dunkel, inkl. Farbenblindheit):
//   PV #c77a05 / #c47f0e · Heizung #3c83f6 / #4a8ef0 · Netz #df3a3a / #e45050
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const db = supabase as any; // Tabellen aus SQL 25 noch nicht in types.ts
const TZ = 'Europe/Vienna';
const hm = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const num = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const tagKurz = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

type PlanRaum = { id: string; name: string; p: number; h: string; t: number[]; ziel: number[]; unter: number };
type Plan = { start: number; pv: number[]; heiz: number[]; netz: number[]; einsp: number[]; bat: number[]; raeume: PlanRaum[] };
type Jetzt = { room_id: string; name: string; t: number; plan_heizt: boolean; steuerung_heizt: boolean; manuell: boolean; auto: boolean; naechst_an: string | null; bis: string | null; t_min: number; t_max: number };
type PlanZeile = { erstellt_at: string; modus: string; plan: Plan; jetzt: Jetzt[]; pv_kwh: number; heiz_kwh: number; netz_kwh: number; einspeis_kwh: number; unter_ziel_gradstd: number; unter_grenze_gradstd: number; nachfuehrung: number };
type Werte = { heiz_kwh: number; netz_kwh: number; unter_ziel_gradstd: number; unter_grenze_gradstd: number; faktor?: number };
type Vergleich = { tag: string; netz_gemessen_kwh: number; steuerung: Werte; planer: Werte; planer_gleich: Werte | null; modell_abw: number };
type Modell = { room_id: string; raum: string; param: { k: number; g: number; s: number; c: number; tau: number }; fehler_12h: number | null; gleich_12h: number | null; heiz_std: number; prior: boolean; gelernt_at: string };

function usePlaner() {
  const [plan, setPlan] = useState<PlanZeile | null>(null);
  const [vergleich, setVergleich] = useState<Vergleich[]>([]);
  const [modell, setModell] = useState<Modell[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [p, v, m] = await Promise.all([
        db.from('heizplan').select('*').order('erstellt_at', { ascending: false }).limit(1),
        db.from('heizplan_vergleich').select('*').order('tag', { ascending: false }).limit(7),
        db.from('heizmodell').select('*'),
      ]);
      if (!alive) return;
      if (p.error) setFehler(p.error.message.includes('heizplan') ? 'SQL 25 ist noch nicht ausgeführt.' : p.error.message);
      setPlan((p.data ?? [])[0] ?? null);
      setVergleich(v.data ?? []);
      setModell(m.data ?? []);
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { plan, vergleich, modell, fehler };
}

function Kachel({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-xl font-bold font-mono">{v}</div>
      {s && <div className="text-xs text-muted-foreground">{s}</div>}
    </div>
  );
}

function PlanChart({ plan }: { plan: Plan }) {
  const data = useMemo(() => plan.pv.map((_, i) => ({
    t: hm((plan.start + i * 900) * 1000),
    pv: Math.round(plan.pv[i] / 100) / 10, heiz: Math.round(plan.heiz[i] / 100) / 10, netz: Math.round(plan.netz[i] / 100) / 10,
    bat: plan.bat[i],
  })), [plan]);
  const tip = { contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 } };
  return (
    <div className="[--c-pv:#c77a05] [--c-heiz:#3c83f6] [--c-netz:#df3a3a] dark:[--c-pv:#c47f0e] dark:[--c-heiz:#4a8ef0] dark:[--c-netz:#e45050]">
      <div className="text-sm font-medium mb-1">Leistung in den nächsten 24 h (kW)</div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" interval={11} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
            <Tooltip {...tip} formatter={(v: number, n: string) => [`${num(v)} kW`, n]} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
            <Area type="stepAfter" dataKey="pv" name="PV-Vorhersage" stroke="var(--c-pv)" strokeWidth={2} fill="var(--c-pv)" fillOpacity={0.12} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="heiz" name="Heizung geplant" stroke="var(--c-heiz)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="netz" name="Netzbezug" stroke="var(--c-netz)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-sm font-medium mt-3 mb-1">Batterie-Ladung (kWh)</div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" interval={11} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} domain={[0, 'dataMax']} />
            <Tooltip {...tip} formatter={(v: number) => [`${num(v)} kWh`, 'Batterie']} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }} />
            <Line type="monotone" dataKey="bat" name="Batterie" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Zeitleiste({ plan }: { plan: Plan }) {
  const blocks = Math.ceil(plan.pv.length / 2);
  const labels = Array.from({ length: blocks }, (_, b) => hm((plan.start + b * 1800) * 1000));
  return (
    <div className="[--c-heiz:#3c83f6] dark:[--c-heiz:#4a8ef0] overflow-x-auto">
      <div className="text-sm font-medium mb-1">Wann heizt welcher Raum? (je Kästchen eine halbe Stunde)</div>
      <table className="text-xs border-separate" style={{ borderSpacing: '2px' }}>
        <tbody>
          {plan.raeume.map(r => (
            <tr key={r.id}>
              <td className="pr-2 whitespace-nowrap text-muted-foreground">{r.name}</td>
              {Array.from({ length: blocks }, (_, b) => {
                const an = r.h[b * 2] === '1';
                const t = r.t[Math.min(r.t.length - 1, b * 2 + 1)];
                return <td key={b} title={`${r.name} · ${labels[b]} · ${an ? 'heizt' : 'aus'} · ${num(t)} °C`}
                  className="w-3 h-4 rounded-[3px]" style={{ background: an ? 'var(--c-heiz)' : 'hsl(var(--muted))' }} />;
              })}
            </tr>
          ))}
          <tr>
            <td />
            {labels.map((l, b) => <td key={b} className="text-[10px] text-muted-foreground align-top">{b % 4 === 0 ? l.slice(0, 2) : ''}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PlanerView() {
  const { plan, vergleich, modell, fehler } = usePlaner();
  if (fehler) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{fehler}</CardContent></Card>;
  if (!plan) return <Card><CardContent className="p-4 text-sm text-muted-foreground">Noch kein Plan – der Planer rechnet alle 15 Minuten.</CardContent></Card>;
  const alt = Date.now() - new Date(plan.erstellt_at).getTime() > 40 * 60_000;
  const uneinig = plan.jetzt.filter(j => j.auto && !j.manuell && j.plan_heizt !== j.steuerung_heizt).length;
  const v0 = vergleich[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm">
              <span className="px-2 py-0.5 rounded-full border text-xs font-medium mr-2">Schattenbetrieb · steuert nicht</span>
              Plan von {hm(new Date(plan.erstellt_at).getTime())}{alt && <span className="text-warning font-medium"> · veraltet</span>}
            </div>
            <div className="text-xs text-muted-foreground">PV nachgeführt ×{num(plan.nachfuehrung, 2)}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kachel k="PV 24 h" v={`${num(plan.pv_kwh)} kWh`} s="Vorhersage" />
            <Kachel k="Heizen" v={`${num(plan.heiz_kwh)} kWh`} s="geplant" />
            <Kachel k="Netz" v={`${num(plan.netz_kwh)} kWh`} s="geplant" />
            <Kachel k="unter Ziel" v={`${num(plan.unter_ziel_gradstd)} °C·h`} s={`unter Untergrenze ${num(plan.unter_grenze_gradstd)}`} />
          </div>
          <PlanChart plan={plan.plan} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium">Jetzt: Planer und heutige Steuerung {uneinig > 0 ? <span className="text-muted-foreground font-normal">· {uneinig} {uneinig === 1 ? 'Raum' : 'Räume'} verschieden</span> : <span className="text-muted-foreground font-normal">· einig</span>}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr><th className="py-1 pr-3 font-normal">Raum</th><th className="pr-3 font-normal">Ist</th><th className="pr-3 font-normal">Planer</th><th className="pr-3 font-normal">Steuerung</th><th className="font-normal">Planer als Nächstes</th></tr>
              </thead>
              <tbody>
                {plan.jetzt.map(j => {
                  const anders = j.auto && !j.manuell && j.plan_heizt !== j.steuerung_heizt;
                  return (
                    <tr key={j.room_id} className={`border-t ${anders ? 'bg-warning/10' : ''}`}>
                      <td className="py-1 pr-3">{j.name}</td>
                      <td className="pr-3 font-mono">{num(j.t)} °C</td>
                      <td className="pr-3">{j.plan_heizt ? 'heizt' : '–'}</td>
                      <td className="pr-3">{j.manuell ? 'manuell' : !j.auto ? 'Automatik aus' : j.steuerung_heizt ? 'heizt' : '–'}</td>
                      <td className="text-muted-foreground">
                        {j.plan_heizt ? (j.bis ? `heizt bis ${hm(new Date(j.bis).getTime())}` : 'heizt durch') : j.naechst_an ? `heizt ab ${hm(new Date(j.naechst_an).getTime())}` : 'heizt in 24 h nicht'}
                        {` · ${num(j.t_min)}–${num(j.t_max)} °C`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-4"><Zeitleiste plan={plan.plan} /></CardContent></Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium">Gegenrechnung: Was hätte der Planer an den letzten Tagen gemacht?</div>
          <div className="text-xs text-muted-foreground">Gleiche Sonne, gleiches Wetter, gleiche Temperaturen um Mitternacht. Beide im selben Raummodell gerechnet; „unter Ziel“ = Grad·Stunden unter Eco (tags) bzw. Nachtwert (nachts), summiert über alle Räume.</div>
          {vergleich.length === 0 ? <div className="text-sm text-muted-foreground">Noch keine Gegenrechnung – kommt jede Nacht um 03:00.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground text-left">
                  <tr><th className="py-1 pr-3 font-normal">Tag</th><th className="pr-3 font-normal">Netz gemessen</th><th className="pr-3 font-normal">Heutige Steuerung</th><th className="pr-3 font-normal">Planer</th><th className="font-normal">Planer bei gleichem Komfort</th></tr>
                </thead>
                <tbody>
                  {vergleich.map(v => (
                    <tr key={v.tag} className="border-t align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">{tagKurz(v.tag)}</td>
                      <td className="pr-3 font-mono">{num(v.netz_gemessen_kwh)} kWh</td>
                      <td className="pr-3">{num(v.steuerung.heiz_kwh)} kWh Heizen · {num(v.steuerung.netz_kwh)} Netz<br /><span className="text-xs text-muted-foreground">unter Ziel {num(v.steuerung.unter_ziel_gradstd, 0)} · unter Untergrenze {num(v.steuerung.unter_grenze_gradstd, 0)} °C·h</span></td>
                      <td className="pr-3">{num(v.planer.heiz_kwh)} kWh Heizen · {num(v.planer.netz_kwh)} Netz<br /><span className="text-xs text-muted-foreground">unter Ziel {num(v.planer.unter_ziel_gradstd, 0)} · unter Untergrenze {num(v.planer.unter_grenze_gradstd, 0)} °C·h</span></td>
                      <td>{v.planer_gleich ? <>{num(v.planer_gleich.netz_kwh)} kWh Netz<br /><span className="text-xs text-muted-foreground">statt {num(v.steuerung.netz_kwh)} kWh</span></> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {v0 && <div className="text-xs text-muted-foreground">Modellprüfung {tagKurz(v0.tag)}: Mit der echten Heizung nachgerechnet weicht das Raummodell im Mittel {num(v0.modell_abw, 2)} °C von den gemessenen Temperaturen ab.</div>}
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold select-none">Was der Planer über jeden Raum gelernt hat</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground text-left">
              <tr><th className="py-1 pr-3 font-normal">Raum</th><th className="pr-3 font-normal">kühlt ab*</th><th className="pr-3 font-normal">heizt auf</th><th className="pr-3 font-normal">Vorhersage 12 h</th><th className="font-normal">Daten</th></tr>
            </thead>
            <tbody>
              {[...modell].sort((a, b) => a.raum.localeCompare(b.raum)).map(m => {
                const besser = m.fehler_12h != null && m.gleich_12h != null && m.fehler_12h < m.gleich_12h;
                return (
                  <tr key={m.room_id} className="border-t">
                    <td className="py-1 pr-3">{m.raum}</td>
                    <td className="pr-3 font-mono whitespace-nowrap">{num(m.param.k * 15, 2)} °C/h</td>
                    <td className="pr-3 font-mono whitespace-nowrap">+{num(m.param.g, 2)} °C/h</td>
                    <td className="pr-3">± {num(m.fehler_12h, 2)} °C <span className={`text-xs ${besser ? 'text-muted-foreground' : 'text-warning'}`}>({besser ? 'besser' : 'nicht besser'} als „bleibt gleich“ ± {num(m.gleich_12h, 2)})</span></td>
                    <td className="text-muted-foreground">{num(m.heiz_std, 0)} h geheizt{m.prior ? ' · an andere Räume angelehnt' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mt-2">* bei 15 °C Unterschied zwischen innen und außen, ohne Heizen und ohne Sonne. Das Modell lernt jede Nacht um 03:00 mit den letzten 30 Tagen neu.</div>
        </div>
      </details>
    </div>
  );
}
