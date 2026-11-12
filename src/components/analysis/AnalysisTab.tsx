// Tab "Analyse" – Rückblick auf Tag, Woche, Monat, Jahr (Stand 26.10.2026).
// Aufbau nach der Heizung München, Inhalte für Venediger. Ersetzt die verstreuten Auswertungen
// aus den früheren Tabs Energie, Heizung & KI und Verlauf & Muster
// (Umzugsliste: doc/NEUE-TAB-STRUKTUR-2026-10-26.md).
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Klappabschnitt } from '@/components/layout/Klappabschnitt';
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
import { BatteryHistoryChart } from '@/components/energy/BatteryHistoryChart';
import { BatterySocHistoryCard } from '@/components/heating/AutomationStatusCards';
import { BatteryReserveStatus } from '@/components/heating/BatteryReserveStatus';
import { HeatingHistoryChart } from '@/components/heating/HeatingHistoryChart';
import { HeatingOverviewCard } from '@/components/heating/HeatingOverviewCard';
import { PvForecastCard } from '@/components/heating/PvForecastCard';
import { PvAccuracyChart } from '@/components/heating/PvAccuracyChart';
import { SolarGainChart } from '@/components/heating/SolarGainChart';

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
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }) : '–');
const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

// ---------------------------------------------------------------- Bausteine

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöü]+/g, '-');
// 12.11.2026: klappbar (Klappabschnitt)
function Section({ n, title, question, children }: { n: number; title: string; question: string; children: React.ReactNode }) {
  return <Klappabschnitt id={`analyse-${slug(title)}`} n={n} titel={title} frage={question} karte farbe="bg-foreground text-background">{children}</Klappabschnitt>;
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
export function AnalysisTab({ rooms, settings, onNavigate }: {
  rooms: Room[];
  settings: HeatingSettings;
  /** Werte von HEUTE für das Kosten-Widget (es speichert den heutigen Tag – nie einen anderen übergeben). */
  onNavigate: (tab: 'ki' | 'settings' | 'auto') => void;
}) {
  const today = viennaDateString();
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

  const reserve = settings.battery_reserve_for_night_soc ?? 60;

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Tag */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Vorheriger Tag" disabled={date <= minDate} onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="px-3 font-semibold min-w-[150px] text-center">{dateLabel(date)}</div>
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Nächster Tag" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <span className="text-xs text-muted-foreground">Tagesdetails für die letzten {DAY_DETAIL_DAYS} Tage · Woche/Monat/Jahr in Auto-Steuerung › Verlauf</span>
      </div>

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

              {/* 12.11.2026: Kennzahlen, PV-Verlauf und Kosten des Tages stehen in Auto-Steuerung › Verlauf (Tag) – hier nicht doppelt. */}
              <Card>
                <CardContent className="p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">PV, Verbrauch, Netz, Batterie und Kosten – je Tag, Woche, Monat und Jahr mit Vergleich – stehen im Tab <b>Auto-Steuerung</b> unter „Verlauf und Wirkung“. Hier: was am Tag auffiel, die Räume und die Prognose.</div>
                  <Button size="sm" onClick={() => onNavigate('auto')}>Zur Auto-Steuerung</Button>
                </CardContent>
              </Card>

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
                </CardContent>
              </Card>

              <Section n={1} title="Batterie" question="Wann wurde sie geladen – und reicht die Reserve für die Nacht?">
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

              <Section n={2} title="Heizung" question="Welcher Raum hat wie lange geheizt – und womit?">
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

            </>
          )}
      </>

      {/* 12.11.2026: Woche/Monat/Jahr, Kennzahlen und Kosten hier ersetzt durch den Tab „Auto-Steuerung“ › Verlauf (energie_tag, SQL 35).
          Die alten Grafiken rechneten mit daily_pattern_scores (etwa Faktor 10 zu niedrig), energy_daily_costs
          (füllt sich nur beim Öffnen der Seite) und Fallback-Preisen. doc/VERLAUF-UND-WIRKUNG-2026-11-12.md */}

      <Section n={3} title="Prognose & Wetter" question="Wie gut war die PV-Prognose – und was kommt?">
        <div className="grid md:grid-cols-2 gap-4">
          <PvForecastCard todayForecast={todayForecast} tomorrowForecast={tomorrowForecast} weekForecasts={forecasts}
            onRefresh={fetchForecast} isRefreshing={isFetching} pvCapacity={settings.pv_capacity_kwp} />
          <PvAccuracyChart />
        </div>
      </Section>

      <Section n={4} title="Räume & Sonne" question="Wie stark erwärmt die Sonne die Räume ohne Heizen?">
        <SolarGainChart rooms={rooms} />
      </Section>

      <div className="text-sm text-muted-foreground text-center py-2">
        KI-Musteranalyse und die Bewertung von KI-Entscheidungen: Tab{' '}
        <button type="button" className="underline text-primary" onClick={() => onNavigate('ki')}>KI</button>
        <> · <button type="button" className="underline text-primary" onClick={reload}>Tag neu berechnen</button></>
      </div>

      <ProposalDialog proposal={proposal} open={!!proposal} onOpenChange={(o) => !o && setProposal(null)} onApplied={() => { setProposal(null); reload(); }} />
    </div>
  );
}
