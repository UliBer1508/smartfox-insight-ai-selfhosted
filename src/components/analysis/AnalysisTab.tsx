// Tab "Analyse" – Rückblick auf Tag, Woche, Monat, Jahr (Stand 26.10.2026).
// Aufbau nach der Heizung München, Inhalte für Venediger. Ersetzt die verstreuten Auswertungen
// aus den früheren Tabs Energie, Heizung & KI und Verlauf & Muster
// (Umzugsliste: doc/NEUE-TAB-STRUKTUR-2026-10-26.md).
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Lightbulb, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Room } from '@/types/room';
import { HeatingSettings } from '@/types/heating';
import { useDayAnalysis } from '@/hooks/useDayAnalysis';
import { usePvForecast } from '@/hooks/usePvForecast';
import { addDays, viennaDateString, DayAnalysis } from '@/lib/dayAnalysis';
import { buildFindings, Finding, Proposal } from '@/lib/analysisFindings';
import { loadWhitelist, WhitelistRow } from '@/lib/aiParameters';
import { ProposalDialog } from './ProposalDialog';
import { ProgressCockpit } from '@/components/energy/stats/ProgressCockpit';
import { YearTrendChart } from '@/components/energy/stats/YearTrendChart';
import { BatteryHistoryChart } from '@/components/energy/BatteryHistoryChart';
import { BatterySocHistoryCard } from '@/components/heating/AutomationStatusCards';
import { BatteryReserveStatus } from '@/components/heating/BatteryReserveStatus';
import { HeatingHistoryChart } from '@/components/heating/HeatingHistoryChart';
import { HeatingOverviewCard } from '@/components/heating/HeatingOverviewCard';
import { PvForecastCard } from '@/components/heating/PvForecastCard';
import { PvAccuracyChart } from '@/components/heating/PvAccuracyChart';
import { SolarGainChart } from '@/components/heating/SolarGainChart';
import { EnergyCostWidget } from '@/components/energy/EnergyCostWidget';

type Period = 'day' | 'week' | 'month' | 'year';
const DAY_DETAIL_DAYS = 7; // energy_readings werden 7 Tage aufbewahrt

const C = {
  haus: '#9aa3ae',
  heizung: '#e8811a',
  batterie: '#13a3b5',
  einspeisung: '#22a559',
  netz: '#d64545',
  sonne: '#e0a800',
};

const kwh = (wh: number, d = 1) => `${(wh / 1000).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} kWh`;
const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)} %`);
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }) : '–');
const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

// ---------------------------------------------------------------- Bausteine
function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'export' | 'import' | 'primary' }) {
  const color = tone === 'export' ? 'text-energy-export' : tone === 'import' ? 'text-energy-import' : tone === 'primary' ? 'text-primary' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Section({ n, title, question, children }: { n: number; title: string; question: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 md:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center font-bold shrink-0" aria-hidden="true">{n}</div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            <div className="text-sm text-muted-foreground">{question}</div>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SplitBar({ parts, label }: { parts: { label: string; wh: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.wh, 0);
  if (total <= 0) return <div className="text-sm text-muted-foreground">Keine Daten</div>;
  return (
    <div className="space-y-2">
      <div className="flex h-3.5 rounded-full overflow-hidden bg-muted" role="img" aria-label={label}>
        {parts.filter(p => p.wh > 0).map(p => <div key={p.label} style={{ width: `${(p.wh / total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map(p => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} <strong>{kwh(p.wh)}</strong> · {Math.round((p.wh / total) * 100)} %
          </span>
        ))}
      </div>
    </div>
  );
}

function More({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full border-t pt-3">
        {title}
        <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const TONE: Record<Finding['tone'], { box: string; icon: typeof Info }> = {
  potential: { box: 'bg-orange-500/10 border-orange-500/30', icon: Lightbulb },
  warning: { box: 'bg-destructive/10 border-destructive/30', icon: AlertTriangle },
  good: { box: 'bg-success/10 border-success/30', icon: CheckCircle2 },
  info: { box: 'bg-muted border-border', icon: Info },
};

// ---------------------------------------------------------------- Tag
function PvChart({ a }: { a: DayAnalysis }) {
  const data = a.points.map(p => ({ ...p, h: p.t / 60 }));
  return (
    <div className="h-64 -ml-2" role="img" aria-label="Tageskurve: Verwendung des Sonnenstroms, Verbrauch, Netzbezug und Prognose">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="h" type="number" domain={[0, 24]} ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)} kW`} tick={{ fontSize: 11 }} width={44} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            labelFormatter={(h) => { const m = Math.round(Number(h) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }}
            formatter={(v: number, name: string) => [`${Math.round(v)} W`, name]}
            contentStyle={{ fontSize: 12 }}
          />
          <Area type="monotone" dataKey="haus" stackId="pv" name="Haus" stroke="none" fill={C.haus} fillOpacity={0.9} isAnimationActive={false} />
          <Area type="monotone" dataKey="heizungSonne" stackId="pv" name="Heizung (Sonne)" stroke="none" fill={C.heizung} fillOpacity={0.9} isAnimationActive={false} />
          <Area type="monotone" dataKey="batterieLaden" stackId="pv" name="Batterie laden" stroke="none" fill={C.batterie} fillOpacity={0.9} isAnimationActive={false} />
          <Area type="monotone" dataKey="einspeisung" stackId="pv" name="Einspeisung" stroke="none" fill={C.einspeisung} fillOpacity={0.9} isAnimationActive={false} />
          <Line type="monotone" dataKey="verbrauch" name="Verbrauch gesamt" stroke="hsl(var(--foreground))" strokeWidth={1.25} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="netz" name="Netzbezug" stroke={C.netz} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          {a.points.some(p => p.prognose != null) && (
            <Line type="monotone" dataKey="prognose" name="PV-Prognose" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function RoomTable({ a }: { a: DayAnalysis }) {
  const rows = a.rooms;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Raum</th>
            <th className="py-2 px-2 font-medium">Heizzeit</th>
            <th className="py-2 px-2 font-medium">Energie</th>
            <th className="py-2 px-2 font-medium">Herkunft</th>
            <th className="py-2 px-2 font-medium w-[34%]">Verlauf 0–24 Uhr</th>
            <th className="py-2 px-2 font-medium">Komfort</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t">
              <td className="py-2 pr-2 font-medium">{r.name}</td>
              <td className="py-2 px-2 tabular-nums">{r.heatMinutes > 0 ? hm(r.heatMinutes) : '–'}</td>
              <td className="py-2 px-2 tabular-nums">{r.heatWh > 0 ? kwh(r.heatWh) : '–'}</td>
              <td className="py-2 px-2">
                {r.heatWh > 0 ? (
                  <div className="flex h-2.5 w-20 rounded-full overflow-hidden bg-muted" role="img"
                    aria-label={`Sonne ${Math.round(r.sunWh / r.heatWh * 100)} %, Batterie ${Math.round(r.batteryWh / r.heatWh * 100)} %, Netz ${Math.round(r.gridWh / r.heatWh * 100)} %`}>
                    <div style={{ width: `${(r.sunWh / r.heatWh) * 100}%`, background: C.sonne }} />
                    <div style={{ width: `${(r.batteryWh / r.heatWh) * 100}%`, background: C.batterie }} />
                    <div style={{ width: `${(r.gridWh / r.heatWh) * 100}%`, background: C.netz }} />
                  </div>
                ) : <span className="text-muted-foreground">–</span>}
              </td>
              <td className="py-2 px-2">
                <div className="relative h-2.5 rounded-full bg-muted">
                  {r.segments.map((s, i) => (
                    <div key={i} className="absolute top-0 h-2.5 rounded-full" style={{ left: `${s.from * 100}%`, width: `${Math.max(0.6, (s.to - s.from) * 100)}%`, background: C.heizung }} />
                  ))}
                </div>
              </td>
              <td className="py-2 px-2 whitespace-nowrap">
                {r.comfortReachedAt
                  ? <span className="text-success font-medium">✓ {timeOf(r.comfortReachedAt)}</span>
                  : <span className="text-muted-foreground">{r.maxTemp != null ? `max ${r.maxTemp.toLocaleString('de-DE')} °C` : 'keine Daten'}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Seite
export function AnalysisTab({ rooms, settings, todayEnergy, onNavigate }: {
  rooms: Room[];
  settings: HeatingSettings;
  /** Werte von HEUTE für das Kosten-Widget (es speichert den heutigen Tag – nie einen anderen übergeben). */
  todayEnergy: { energyIn: number; energyOut: number; pvEnergy: number };
  onNavigate: (tab: 'ki' | 'settings') => void;
}) {
  const today = viennaDateString();
  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState(today);
  const minDate = addDays(today, -(DAY_DETAIL_DAYS - 1));
  const [whitelist, setWhitelist] = useState<WhitelistRow[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const { todayForecast, tomorrowForecast, forecasts, isFetching, fetchForecast, loadForecasts } = usePvForecast();

  useEffect(() => { loadWhitelist().then(setWhitelist); loadForecasts(); }, [loadForecasts]);

  // Räume nur bei inhaltlicher Änderung neu durchrechnen (useRooms pollt alle 15 s)
  const roomsKey = JSON.stringify(rooms.map(r => [r.id, r.name, r.comfort_temp, r.automation_enabled, r.pv_auto_enabled, r.calculated_power_w, r.heating_power_w, r.power_calculation_confidence, r.power_samples, r.floor_area_m2, r.tuya_device_id]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRooms = useMemo(() => rooms, [roomsKey]);
  const { data: a, loading, error, reload } = useDayAnalysis(date, stableRooms, settings.night_start_time, settings.night_end_time);
  const findings = useMemo(() => (a ? buildFindings(a, settings, whitelist) : []), [a, settings, whitelist]);

  const price = Number(settings.electricity_price_kwh_cent ?? 20.28);
  const feedIn = Number(settings.feed_in_price_kwh_cent ?? 8);
  const reserve = settings.battery_reserve_for_night_soc ?? 60;

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Zeitraum */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Zeitraum" className="flex bg-muted rounded-lg p-1 gap-0.5">
          {(['day', 'week', 'month', 'year'] as Period[]).map(p => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-md text-sm ${period === p ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {{ day: 'Tag', week: 'Woche', month: 'Monat', year: 'Jahr' }[p]}
            </button>
          ))}
        </div>
        {period === 'day' && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Vorheriger Tag" disabled={date <= minDate} onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="px-3 font-semibold min-w-[150px] text-center">{dateLabel(date)}</div>
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Nächster Tag" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        )}
        {period === 'day' && <span className="text-xs text-muted-foreground">Tagesdetails für die letzten {DAY_DETAIL_DAYS} Tage · ältere Tage über Woche/Monat</span>}
      </div>

      {period === 'day' && (
        <>
          {loading && !a && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Rechne den Tag durch …</div>}
          {error && <div className="text-sm text-destructive">Fehler beim Laden: {error}</div>}
          {a && (
            <>
              {!a.complete && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
                  Unvollständiger Tag: Messwerte bis {timeOf(a.lastReading)} – Summen gelten bis jetzt. Einstellungs-Vorschläge gibt es erst für abgeschlossene Tage.
                </div>
              )}
              {a.complete && a.coveredHours < 20 && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
                  Nur {a.coveredHours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stunden Messwerte – Summen sind zu niedrig.
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Tile label="PV" value={kwh(a.pvWh)} sub={a.forecastKwh ? `Prognose ${a.forecastKwh.toLocaleString('de-DE')} kWh` : 'keine Prognose'} />
                <Tile label="Verbrauch" value={kwh(a.consumptionWh)} sub={`davon Heizung ${kwh(a.heatWh)}`} />
                <Tile label="Eigenverbrauch" value={pct(a.selfConsumption)} sub={`Autarkie ${pct(a.autarky)}`} tone="primary" />
                <Tile label="Eingespeist" value={kwh(a.exportWh)} sub={`Vergütung ${(a.exportWh / 1000 * feedIn / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`} tone="export" />
                <Tile label="Netzbezug" value={kwh(a.importWh)} sub={`davon Heizung ${kwh(a.heatGridWh)}`} tone="import" />
                <Tile label="Batterie" value={`${a.socMin != null ? Math.round(a.socMin) : '–'} … ${a.socMax != null ? Math.round(a.socMax) : '–'} %`} sub={`geladen ${kwh(a.chargeWh)}`} />
              </div>

              <Card>
                <CardContent className="p-4 md:p-5 space-y-3">
                  <h2 className="text-base font-semibold">Das Wichtigste</h2>
                  {findings.length === 0 && <div className="text-sm text-muted-foreground">Noch zu wenige Daten für diesen Tag.</div>}
                  {findings.map(f => {
                    const t = TONE[f.tone];
                    const Icon = t.icon;
                    return (
                      <div key={f.id} className={`rounded-lg border p-3 ${t.box}`}>
                        <div className="flex gap-2.5">
                          <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="font-semibold text-sm">{f.title}</div>
                            <div className="text-sm text-muted-foreground">{f.text}</div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {f.proposal && (
                                <Button size="sm" onClick={() => setProposal(f.proposal!)}>
                                  Vorschlag: {f.proposal.label} {String(f.proposal.current)} → {f.proposal.proposed === 'frost_only' ? 'Nur Frostschutz' : `${f.proposal.proposed}${f.proposal.unit ? ` ${f.proposal.unit}` : ''}`}
                                </Button>
                              )}
                              {f.link && <Button size="sm" variant="outline" onClick={() => onNavigate(f.link!.tab)}>{f.link.label}</Button>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <More title="Tageswertung der KI (Score, Eigenverbrauch-Trend)">
                    <ProgressCockpit range="day" />
                  </More>
                </CardContent>
              </Card>

              <Section n={1} title="PV-Anlage" question="Wohin ging der Sonnenstrom? Gestrichelt: Prognose">
                <SplitBar label="Verwendung des Sonnenstroms" parts={[
                  { label: 'Haus', wh: a.hausFromPvWh, color: C.haus },
                  { label: 'Heizung', wh: Math.min(a.heatSunWh, Math.max(0, a.pvWh - a.exportWh - a.chargeWh)), color: C.heizung },
                  { label: 'Batterie geladen', wh: a.chargeWh, color: C.batterie },
                  { label: 'Eingespeist', wh: a.exportWh, color: C.einspeisung },
                ]} />
                <PvChart a={a} />
              </Section>

              <Section n={2} title="Batterie" question="Wann wurde sie geladen – und reicht die Reserve für die Nacht?">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>max. <strong>{a.socMax != null ? Math.round(a.socMax) : '–'} %</strong></span>
                  <span>min. <strong>{a.socMin != null ? Math.round(a.socMin) : '–'} %</strong>{a.socMinAt && ` (${timeOf(a.socMinAt)})`}</span>
                  <span>geladen <strong>{kwh(a.chargeWh)}</strong></span>
                  <span>entladen <strong>{kwh(a.dischargeWh)}</strong></span>
                  {a.socAtNightStart != null
                    ? <span className={a.socAtNightStart >= reserve ? 'text-success font-semibold' : 'text-destructive font-semibold'}>
                        Nacht-Reserve {reserve} % zu Nachtbeginn: {a.socAtNightStart >= reserve ? 'erreicht' : 'verfehlt'} ({Math.round(a.socAtNightStart)} %)
                      </span>
                    : <span className="text-muted-foreground">Nachtbeginn noch nicht erreicht</span>}
                </div>
                <BatteryHistoryChart />
                <More title="Batterie-Reserve-Prüfung & Verlauf der Batterie-Grenzwerte">
                  <BatteryReserveStatus currentSoc={a.socMax ?? undefined} />
                  <BatterySocHistoryCard />
                </More>
              </Section>

              <Section n={3} title="Heizung" question="Welcher Raum hat wie lange geheizt – und womit?">
                <SplitBar label="Herkunft der Heizenergie" parts={[
                  { label: 'Sonne', wh: a.heatSunWh, color: C.sonne },
                  { label: 'Batterie', wh: a.heatBatteryWh, color: C.batterie },
                  { label: 'Netz', wh: a.heatGridWh, color: C.netz },
                ]} />
                <RoomTable a={a} />
                <div className="text-xs text-muted-foreground">
                  Heizenergie geschätzt: Raumleistung × Zeit mit „heizt“ (Thermostat-Meldung alle ~5 min). Herkunft: Netzbezug und Batterie werden der Heizung zuerst zugerechnet.
                  {!a.heatingDataReliable && ' Vor dem 24.10.2026 meldeten die Thermostate „heizt“ nie – diese Werte sind nicht aussagekräftig.'}
                </div>
                <More title="Heizverlauf der letzten Tage & Heizverbrauch Monat/Jahr">
                  <HeatingHistoryChart rooms={rooms} />
                  <HeatingOverviewCard rooms={rooms} />
                </More>
              </Section>

              <Section n={4} title="Kosten" question="Was hat der Tag gekostet – und was hat die Sonne gespart?">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Strombezug</div><div className="text-lg font-bold text-energy-import">{(a.importWh / 1000 * price / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Einspeisung</div><div className="text-lg font-bold text-energy-export">+{(a.exportWh / 1000 * feedIn / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">PV-Ersparnis</div><div className="text-lg font-bold">{(Math.max(0, a.pvWh - a.exportWh) / 1000 * price / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Heizung aus dem Netz</div><div className="text-lg font-bold">{(a.heatGridWh / 1000 * price / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                </div>
                <More title="Kosten heute, Monat, Jahr">
                  <EnergyCostWidget
                    energyIn={todayEnergy.energyIn} energyOut={todayEnergy.energyOut} pvEnergy={todayEnergy.pvEnergy}
                    electricityPriceCent={price} feedInPriceCent={feedIn}
                    baseFeePerYearEur={settings.electricity_base_fee_year_eur ?? 36}
                  />
                </More>
              </Section>
            </>
          )}
        </>
      )}

      {period !== 'day' && (
        <>
          {period === 'year' ? <YearTrendChart /> : <ProgressCockpit range={period} />}
          <Card><CardContent className="p-4 md:p-5"><HeatingOverviewCard rooms={rooms} /></CardContent></Card>
          <EnergyCostWidget
            energyIn={todayEnergy.energyIn} energyOut={todayEnergy.energyOut} pvEnergy={todayEnergy.pvEnergy}
            electricityPriceCent={price} feedInPriceCent={feedIn}
            baseFeePerYearEur={settings.electricity_base_fee_year_eur ?? 36}
          />
        </>
      )}

      <Section n={period === 'day' ? 5 : 1} title="Prognose & Wetter" question="Wie gut war die PV-Prognose – und was kommt?">
        <div className="grid md:grid-cols-2 gap-4">
          <PvForecastCard todayForecast={todayForecast} tomorrowForecast={tomorrowForecast} weekForecasts={forecasts}
            onRefresh={fetchForecast} isRefreshing={isFetching} pvCapacity={settings.pv_capacity_kwp} />
          <PvAccuracyChart />
        </div>
      </Section>

      <Section n={period === 'day' ? 6 : 2} title="Räume & Sonne" question="Wie stark erwärmt die Sonne die Räume ohne Heizen?">
        <SolarGainChart rooms={rooms} />
      </Section>

      <div className="text-sm text-muted-foreground text-center py-2">
        KI-Musteranalyse und die Bewertung von KI-Entscheidungen: Tab{' '}
        <button type="button" className="underline text-primary" onClick={() => onNavigate('ki')}>KI</button>
        {period === 'day' && <> · <button type="button" className="underline text-primary" onClick={reload}>Tag neu berechnen</button></>}
      </div>

      <ProposalDialog proposal={proposal} open={!!proposal} onOpenChange={(o) => !o && setProposal(null)} onApplied={() => { setProposal(null); reload(); }} />
    </div>
  );
}
