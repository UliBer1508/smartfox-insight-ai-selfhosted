// Tab "Protokoll" – Test- und Protokoll-Modul (01.11.2026, doc/PROTOKOLL-MODUL-2026-11-01.md)
//   Ereignisse   – protokoll_events (Trigger, SQL 11): Sollwerte mit Begründung, heizt an/aus, Modus,
//                  Einstellungen alt → neu, Anwesenheit, Thermostat-Auffälligkeiten, Fehler
//   Thermostate  – thermostat_state (Dienst v1.4) + gemessene Schaltpunkte; Auslesen und Datenpunkt
//                  setzen per Befehl (read_now / set_dp) statt Skript
//   Energie      – Verbrauch je Stunde gegen heizende Räume, Heizenergie je Raum nach Quelle
//   Nächte       – nacht_protokoll (SQL 10): Frostschutz gegen Nachtwert
// Aufbau wie der Protokoll-Tab der Heizung München.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Room } from '@/types/room';
import { Tables } from '@/integrations/supabase/types';

type View = 'ereignisse' | 'thermostate' | 'energie' | 'naechte';
type Event = Tables<'protokoll_events'>;
type TState = Tables<'thermostat_state'>;
type Night = Tables<'nacht_protokoll'>;

const TZ = 'Europe/Vienna';
const KINDS: { key: string; label: string; cls: string }[] = [
  { key: 'sollwert', label: 'Sollwert', cls: 'bg-primary/10 text-primary' },
  { key: 'heizt', label: 'Heizt', cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  { key: 'modus', label: 'Modus', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' },
  { key: 'einstellung', label: 'Einstellung', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { key: 'anwesenheit', label: 'Anwesenheit', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  { key: 'thermostat', label: 'Thermostat', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-300' },
  { key: 'fehler', label: 'Fehler', cls: 'bg-destructive text-destructive-foreground' },
];
const kindMeta = (k: string) => KINDS.find((x) => x.key === k) ?? { key: k, label: k, cls: 'bg-muted text-muted-foreground' };

const num = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${Number(v) > 0 ? '+' : ''}${num(v, d)}`);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
const viennaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1 max-w-full">
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`h-9 rounded-md px-3 text-sm ${value === k ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ================================================================ Ereignisse
function EventsView({ rooms }: { rooms: Room[] }) {
  const [rows, setRows] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [kind, setKind] = useState<string>('alle');
  const [room, setRoom] = useState<string>('alle');
  const [days, setDays] = useState<number>(1);

  const load = useCallback(async () => {
    let q = supabase.from('protokoll_events').select('*')
      .gte('ts', new Date(Date.now() - days * 86400_000).toISOString())
      .order('ts', { ascending: false }).limit(500);
    if (kind !== 'alle') q = q.eq('kind', kind);
    if (room !== 'alle') q = q.eq('room_id', room);
    const { data, error } = await q;
    if (error) setMissing(true);
    else { setMissing(false); setRows(data ?? []); }
    setLoading(false);
  }, [kind, room, days]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  let lastDay = '';
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[{ key: 'alle', label: 'Alle', cls: '' }, ...KINDS].map((k) => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)}
                className={`rounded-full border px-3 py-1 text-xs ${kind === k.key ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted'}`}>
                {k.label}
              </button>
            ))}
          </div>
          <select aria-label="Raum" value={room} onChange={(e) => setRoom(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs">
            <option value="alle">alle Räume</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select aria-label="Zeitraum" value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs">
            <option value={1}>24 Stunden</option>
            <option value={3}>3 Tage</option>
            <option value={7}>7 Tage</option>
            <option value={30}>30 Tage</option>
          </select>
        </div>
        {missing && <p className="text-sm text-warning">Protokoll noch nicht eingerichtet – SQL <code>11_protokoll_modul.sql</code> ausführen.</p>}
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : rows.length === 0 && !missing ? (
          <p className="text-sm text-muted-foreground">Keine Einträge in diesem Zeitraum.</p>
        ) : (
          <div>
            {rows.map((e) => {
              const d = dayOf(e.ts);
              const head = d !== lastDay ? (lastDay = d) : null;
              const m = kindMeta(e.kind);
              return (
                <div key={e.id}>
                  {head && <div className="pt-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{head}</div>}
                  <div className="grid grid-cols-[48px_1fr] gap-3 py-2 border-t first:border-t-0 text-sm">
                    <span className="tabular-nums text-muted-foreground">{timeOf(e.ts)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.cls}`}>{m.label}</span>
                        {e.raum && <span className="font-semibold">{e.raum}</span>}
                        <span className="break-words">{e.title}</span>
                      </div>
                      {e.detail && <div className="text-xs text-muted-foreground break-words">{e.detail}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ================================================================ Thermostate
type Schalt = { room_id: string; raum: string; leistung_w: number | null; einschaltungen: number; ein_bei: number | null; aus_bei: number | null; nachlauf: number | null; heiz_min: number | null; zyklus_min: number | null };

// Bedeutung laut Tuya-Datenmodell baugleicher BEOK-Thermostate (doc/THERMOSTAT-DATENPUNKTE.md)
const DP_OPTIONS: { dp: string; label: string; min: number; max: number; hint: string }[] = [
  { dp: '19', label: 'DP 19 – Temperatur-Korrektur', min: -99, max: 99, hint: 'Zehntel-Grad: −10 = −1,0 °C (heute überall), 0 = keine Korrektur' },
  { dp: '101', label: 'DP 101 – Einschalt-Differenz', min: 5, max: 100, hint: 'Zehntel-Grad, in 5er-Schritten: 10 = 1,0 °C (heute überall)' },
  { dp: '111', label: 'DP 111 – Nachtmodus des Geräts', min: 0, max: 1, hint: '0 = aus, 1 = an. Eigenes Nachtprogramm im Thermostat (läuft mit dessen falscher Uhr)' },
  { dp: '103', label: 'DP 103 – Frostschutz des Geräts', min: 0, max: 1, hint: '0 = aus, 1 = an' },
];

function ThermostatsView({ rooms }: { rooms: Room[] }) {
  const [states, setStates] = useState<TState[]>([]);
  const [schalt, setSchalt] = useState<Schalt[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(false);
  const [dpRoom, setDpRoom] = useState<string>('');
  const [dp, setDp] = useState<string>('19');
  const [dpVal, setDpVal] = useState<string>('0');
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s, error }, { data: p }] = await Promise.all([
      supabase.from('thermostat_state').select('*'),
      supabase.rpc('protokoll_schaltpunkte', { p_tage: 3 }),
    ]);
    setMissing(!!error);
    setStates(s ?? []);
    setSchalt((p ?? []) as Schalt[]);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const thermoRooms = rooms.filter((r) => r.tuya_device_id);
  const byRoom = useMemo(() => new Map(states.map((s) => [s.room_id, s])), [states]);
  const schaltBy = useMemo(() => new Map(schalt.map((s) => [s.room_id, s])), [schalt]);

  const readAll = async () => {
    setBusy(true);
    const { error } = await supabase.from('thermostat_commands').insert(
      thermoRooms.map((r) => ({ room_id: r.id, command: 'read_now', status: 'pending', reason: 'App: alle auslesen' })));
    setBusy(false);
    if (error) toast({ title: 'Auslesen nicht angestoßen', description: error.message, variant: 'destructive' });
    else toast({ title: 'Auslesen angestoßen', description: 'Der Thermostat-Dienst liest alle Geräte in der nächsten Minute.' });
    setTimeout(load, 45_000);
  };

  const opt = DP_OPTIONS.find((o) => o.dp === dp)!;
  const valNum = Number(dpVal);
  const valOk = dpVal.trim() !== '' && Number.isInteger(valNum) && valNum >= opt.min && valNum <= opt.max;
  const targets = dpRoom === 'alle' ? thermoRooms : thermoRooms.filter((r) => r.id === dpRoom);
  const sendDp = async () => {
    setBusy(true);
    const { error } = await supabase.from('thermostat_commands').insert(
      targets.map((r) => ({ room_id: r.id, command: 'set_dp', value_text: dp, value: valNum, status: 'pending', reason: `App: Test ${opt.label}` })));
    setBusy(false);
    setConfirm(false);
    if (error) toast({ title: 'Nicht gesendet', description: error.message, variant: 'destructive' });
    else toast({ title: 'Gesendet', description: `DP ${dp} = ${valNum} an ${targets.length} Thermostat(e). Ergebnis erscheint im Protokoll.` });
  };

  const rowsSorted = [...thermoRooms].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const newest = states.reduce<string | null>((m, s) => (!m || s.read_at > m ? s.read_at : m), null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">Thermostate · am Gerät gelesen</h3>
            <span className="text-xs text-muted-foreground">{newest ? `Stand ${timeOf(newest)}` : 'noch keine Daten vom Dienst v1.4'}</span>
          </div>
          {missing && <p className="text-sm text-warning">Noch nicht eingerichtet – SQL <code>11_protokoll_modul.sql</code> ausführen und Thermostat-Dienst v1.4 einspielen.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                  <th className="py-2 pr-3 font-medium">Raum</th>
                  <th className="py-2 px-2 font-medium text-right">Soll</th>
                  <th className="py-2 px-2 font-medium text-right">Ist</th>
                  <th className="py-2 px-2 font-medium">Heizt</th>
                  <th className="py-2 px-2 font-medium">Modus</th>
                  <th className="py-2 px-2 font-medium text-right" title="DP 19 Temperatur-Korrektur">Korr.</th>
                  <th className="py-2 px-2 font-medium text-right" title="DP 101 Einschalt-Differenz">Diff.</th>
                  <th className="py-2 px-2 font-medium" title="DP 111 Nachtmodus des Geräts">Nacht</th>
                  <th className="py-2 px-2 font-medium text-right" title="Abstand zum Soll beim Einschalten, letzte 3 Tage">Ein bei</th>
                  <th className="py-2 px-2 font-medium text-right" title="Abstand zum Soll beim Ausschalten, letzte 3 Tage">Aus bei</th>
                  <th className="py-2 px-2 font-medium text-right" title="höchster Wert nach dem Ausschalten">Nachlauf</th>
                  <th className="py-2 px-2 font-medium text-right">Heizen 3 T</th>
                  <th className="py-2 pl-2 font-medium">Befund</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.map((r) => {
                  const s = byRoom.get(r.id);
                  const p = schaltBy.get(r.id);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 pr-3 whitespace-nowrap">{r.name}</td>
                      <td className="py-2 px-2 text-right">{num(s?.soll)}</td>
                      <td className="py-2 px-2 text-right">{num(s?.ist)}</td>
                      <td className={`py-2 px-2 ${s?.heizt ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{s ? (s.heizt ? 'ja' : 'nein') : '–'}</td>
                      <td className={`py-2 px-2 ${s?.mode && s.mode !== 'home' ? 'text-destructive font-semibold' : ''}`}>{s?.mode ?? '–'}</td>
                      <td className="py-2 px-2 text-right">{signed(s?.korrektur)}</td>
                      <td className="py-2 px-2 text-right">{s?.dp101 != null ? num(Number(s.dp101) / 10) : '–'}</td>
                      <td className={`py-2 px-2 ${(s?.dps as Record<string, unknown> | undefined)?.['111'] === true ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                        {s ? ((s.dps as Record<string, unknown>)?.['111'] === true ? 'an' : 'aus') : '–'}
                      </td>
                      <td className="py-2 px-2 text-right">{signed(p?.ein_bei, 2)}</td>
                      <td className="py-2 px-2 text-right">{signed(p?.aus_bei, 2)}</td>
                      <td className="py-2 px-2 text-right">{signed(p?.nachlauf, 2)}</td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">{p?.heiz_min != null ? `${Math.round(Number(p.heiz_min) / 60)} h · ${p.einschaltungen}×` : '–'}</td>
                      <td className="py-2 pl-2">
                        {s?.befund
                          ? <span className="rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs whitespace-nowrap">{s.befund}</span>
                          : s ? <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs">ok</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Hint>
            „Ein bei / Aus bei“: Abstand zum Sollwert in °C, bei dem das Thermostat in den letzten 3 Tagen ein- bzw. ausgeschaltet hat
            (nur bei Sollwerten, die seit mindestens 30 Minuten galten). Positive Werte heißen: Das Thermostat heizt über den Sollwert hinaus.
          </Hint>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={readAll} disabled={busy || thermoRooms.length === 0}>
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />} Alle jetzt auslesen
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRaw((v) => !v)}>{raw ? 'Rohdaten ausblenden' : 'Alle Datenpunkte (Rohdaten)'}</Button>
          </div>
          {raw && (
            <div className="overflow-x-auto rounded-md border">
              <table className="text-xs font-mono">
                <tbody>
                  {rowsSorted.map((r) => {
                    const d = (byRoom.get(r.id)?.dps ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={r.id} className="border-t first:border-t-0">
                        <td className="py-1.5 px-2 whitespace-nowrap font-sans">{r.name}</td>
                        {Object.keys(d).sort((a, b) => Number(a) - Number(b)).map((k) => (
                          <td key={k} className="py-1.5 px-2 whitespace-nowrap"><span className="text-muted-foreground">{k}:</span>{JSON.stringify(d[k])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Thermostat-Einstellung testen</h3>
          <Hint>
            Schreibt einen Datenpunkt direkt ins Thermostat. Freigegeben sind DP 19, 101, 103 und 111. Erst an einem Raum testen,
            dann einen halben Tag die Schaltpunkte oben beobachten. Jede Änderung steht mit altem und neuem Wert im Protokoll.
          </Hint>
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_120px_auto] items-end">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Raum</span>
              <select value={dpRoom} onChange={(e) => { setDpRoom(e.target.value); setConfirm(false); }} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">– wählen –</option>
                {rowsSorted.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="alle">alle Thermostate</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Datenpunkt</span>
              <select value={dp} onChange={(e) => { setDp(e.target.value); setConfirm(false); }} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                {DP_OPTIONS.map((o) => <option key={o.dp} value={o.dp}>{o.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Neuer Wert</span>
              <Input value={dpVal} onChange={(e) => { setDpVal(e.target.value); setConfirm(false); }} inputMode="numeric" />
            </label>
            {!confirm ? (
              <Button variant="outline" disabled={!dpRoom || !valOk || busy} onClick={() => setConfirm(true)}>Senden …</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="destructive" onClick={sendDp} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `Ja, an ${targets.length} senden`}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>Abbrechen</Button>
              </div>
            )}
          </div>
          <Hint>{opt.hint} · erlaubt {opt.min} bis {opt.max}{!valOk && dpVal ? ' · Wert ungültig' : ''}</Hint>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================ Energie
type Std = { stunde: string; verbrauch_w: number | null; heizung_w: number | null; rest_w: number | null; pv_w: number | null; batt_w: number | null; netz_w: number | null; soc: number | null };
type RaumE = { room_id: string; raum: string; heiz_min: number | null; kwh: number | null; pv_kwh: number | null; batt_kwh: number | null; netz_kwh: number | null };

function EnergyView() {
  const [tag, setTag] = useState(viennaToday());
  const [std, setStd] = useState<Std[]>([]);
  const [raeume, setRaeume] = useState<RaumE[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      supabase.rpc('protokoll_energie_stunden', { p_tag: tag }),
      supabase.rpc('protokoll_energie_raeume', { p_tag: tag }),
    ]).then(([a, b]) => {
      if (!alive) return;
      setMissing(!!a.error);
      setStd((a.data ?? []) as Std[]);
      setRaeume((b.data ?? []) as RaumE[]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [tag]);

  const max = Math.max(1000, ...std.map((s) => Number(s.verbrauch_w ?? 0)));
  const sum = (k: keyof Std) => std.reduce((a, s) => a + Number(s[k] ?? 0), 0) / 1000;
  const isToday = tag === viennaToday();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Energieabgleich</h3>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Tag zurück" onClick={() => setTag(shiftDay(tag, -1))}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="min-w-[120px] text-center text-sm font-medium">{new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
              <Button variant="outline" size="icon" aria-label="Tag vor" disabled={isToday} onClick={() => setTag(shiftDay(tag, 1))}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
          <Hint>Gemessener Hausverbrauch je Stunde gegen die Summe der Räume, die laut Thermostat heizen (Leistung × Anteil der Stunde). „Rest“ ist Grundlast plus alles, was die Thermostate nicht melden.</Hint>
          {missing && <p className="text-sm text-warning">Noch nicht eingerichtet – SQL <code>11_protokoll_modul.sql</code> ausführen.</p>}
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : std.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Messwerte für diesen Tag (Energiedaten werden 7 Tage aufbewahrt).</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                {[
                  ['Verbrauch', sum('verbrauch_w')], ['Heizung', sum('heizung_w')], ['Rest', sum('rest_w')],
                  ['aus Batterie', sum('batt_w')], ['aus Netz', sum('netz_w')],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-md bg-muted/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{l}</div>
                    <div className="font-semibold tabular-nums">{num(v as number)} kWh</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                {std.map((s) => {
                  const h = Number(s.heizung_w ?? 0), r = Math.max(0, Number(s.rest_w ?? 0));
                  return (
                    <div key={s.stunde} className="grid grid-cols-[36px_1fr_88px] items-center gap-2 text-xs tabular-nums">
                      <span className="text-muted-foreground">{timeOf(s.stunde).slice(0, 2)} h</span>
                      <div className="h-3.5 rounded bg-muted flex overflow-hidden" title={`Heizung ${Math.round(h)} W · Rest ${Math.round(r)} W · PV ${s.pv_w} W · Batterie ${s.batt_w} W · Netz ${s.netz_w} W · SOC ${s.soc} %`}>
                        <div className="bg-orange-500" style={{ width: `${(h / max) * 100}%` }} />
                        <div className="bg-slate-400/70" style={{ width: `${(r / max) * 100}%` }} />
                      </div>
                      <span className="text-right">{num(Number(s.verbrauch_w ?? 0) / 1000)} kW · {num(s.soc, 0)} %</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500 mr-1.5" />Heizung (Räume mit „heizt“)</span>
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-400/70 mr-1.5" />Rest (Grundlast, nicht erklärt)</span>
                <span>rechts: Verbrauch · Batterie-Ladestand</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {raeume.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="font-semibold">Heizung je Raum</h3>
            <Hint>Quelle anteilig je Stunde aus PV, Batterie und Netz. Räume ohne eingetragene Leistung zählen mit 0 kWh.</Hint>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                    <th className="py-2 pr-3 font-medium">Raum</th>
                    <th className="py-2 px-2 font-medium text-right">Heizen</th>
                    <th className="py-2 px-2 font-medium text-right">kWh</th>
                    <th className="py-2 px-2 font-medium text-right">PV</th>
                    <th className="py-2 px-2 font-medium text-right">Batterie</th>
                    <th className="py-2 pl-2 font-medium text-right">Netz</th>
                  </tr>
                </thead>
                <tbody>
                  {raeume.map((r) => (
                    <tr key={r.room_id} className="border-t">
                      <td className="py-2 pr-3">{r.raum}</td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">{r.heiz_min != null ? `${Math.floor(Number(r.heiz_min) / 60)} h ${String(Math.round(Number(r.heiz_min) % 60)).padStart(2, '0')}` : '–'}</td>
                      <td className="py-2 px-2 text-right font-semibold">{num(r.kwh)}</td>
                      <td className="py-2 px-2 text-right">{num(r.pv_kwh)}</td>
                      <td className="py-2 px-2 text-right">{num(r.batt_kwh)}</td>
                      <td className="py-2 pl-2 text-right">{num(r.netz_kwh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ================================================================ Nächte
function NightsView() {
  const [rows, setRows] = useState<Night[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('nacht_protokoll').select('*').order('nacht', { ascending: false }).limit(12 * 31)
      .then(({ data, error }) => { setMissing(!!error); setRows(data ?? []); setLoading(false); });
  }, []);

  const nights = useMemo(() => {
    const m = new Map<string, Night[]>();
    rows.forEach((r) => m.set(r.nacht, [...(m.get(r.nacht) ?? []), r]));
    return [...m.entries()].map(([nacht, rs]) => {
      const done = rs.filter((r) => r.ausgewertet_at);
      const avg = (f: (r: Night) => number | null) => {
        const v = done.map(f).filter((x): x is number => x != null);
        return v.length ? v.reduce((a, b) => a + Number(b), 0) / v.length : null;
      };
      const knapp = done.map((r) => (r.temp_morgens != null && r.untergrenze != null ? Number(r.temp_morgens) - Number(r.untergrenze) : null)).filter((x): x is number => x != null);
      return {
        nacht, modus: rs[0].modus, quelle: rs[0].quelle, ausgewertet: done.length > 0,
        aussen: rs[0].aussen_avg, morgens: avg((r) => r.temp_morgens), knapp: knapp.length ? Math.min(...knapp) : null,
        heiz: done.reduce((a, r) => a + Number(r.heiz_kwh ?? 0), 0), netz: rs[0].netz_kwh,
        soc: rs[0].soc_abends != null ? `${Math.round(Number(rs[0].soc_abends))} → ${Math.round(Number(rs[0].soc_morgens ?? 0))} %` : '–',
      };
    });
  }, [rows]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="font-semibold">Nächte · Frostschutz gegen Nachtwert</h3>
        <Hint>Aus dem Nacht-Protokoll (abends 21:55 Einstellungen gemerkt, morgens 09:55 ausgewertet). Nächte mit ähnlicher Außentemperatur vergleichen. „Knappster Raum“: Abstand des kältesten Raums morgens zu seiner Untergrenze.</Hint>
        {missing && <p className="text-sm text-warning">Nacht-Protokoll fehlt – SQL <code>10_nacht_protokoll.sql</code> ausführen.</p>}
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                  <th className="py-2 pr-3 font-medium">Nacht</th>
                  <th className="py-2 px-2 font-medium">Modus</th>
                  <th className="py-2 px-2 font-medium text-right">Außen</th>
                  <th className="py-2 px-2 font-medium text-right">Ø morgens</th>
                  <th className="py-2 px-2 font-medium text-right">knappster Raum</th>
                  <th className="py-2 px-2 font-medium text-right">Heizen kWh</th>
                  <th className="py-2 px-2 font-medium text-right">Netz kWh</th>
                  <th className="py-2 pl-2 font-medium text-right">Batterie</th>
                </tr>
              </thead>
              <tbody>
                {nights.map((n) => (
                  <tr key={n.nacht} className="border-t">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(`${n.nacht}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}{n.quelle === 'nachgetragen' ? ' *' : ''}</td>
                    <td className="py-2 px-2">{n.modus === 'maintain' ? 'Nachtwert' : 'Frostschutz'}</td>
                    {n.ausgewertet ? (
                      <>
                        <td className="py-2 px-2 text-right">{num(n.aussen)}</td>
                        <td className="py-2 px-2 text-right">{num(n.morgens)}</td>
                        <td className={`py-2 px-2 text-right ${n.knapp != null && n.knapp < 0 ? 'text-destructive font-semibold' : ''}`}>{signed(n.knapp)}</td>
                        <td className="py-2 px-2 text-right">{num(n.heiz, 2)}</td>
                        <td className="py-2 px-2 text-right">{num(n.netz, 2)}</td>
                        <td className="py-2 pl-2 text-right whitespace-nowrap">{n.soc}</td>
                      </>
                    ) : <td className="py-2 px-2 text-muted-foreground" colSpan={6}>wird morgen 09:55 ausgewertet</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {nights.some((n) => n.quelle === 'nachgetragen') && <Hint>* nachgetragen (Raumwerte vom 01.11.2026)</Hint>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ================================================================ Tab
export function ProtokollTab({ rooms }: { rooms: Room[] }) {
  const [view, setView] = useState<View>(() => {
    try { return (localStorage.getItem('protokoll-view') as View) || 'ereignisse'; } catch { return 'ereignisse'; }
  });
  const change = (v: View) => {
    setView(v);
    try { localStorage.setItem('protokoll-view', v); } catch { /* egal */ }
  };
  return (
    <div className="space-y-4">
      <Seg<View> value={view} onChange={change}
        items={[['ereignisse', 'Ereignisse'], ['thermostate', 'Thermostate'], ['energie', 'Energie'], ['naechte', 'Nächte']]} />
      {view === 'ereignisse' && <EventsView rooms={rooms} />}
      {view === 'thermostate' && <ThermostatsView rooms={rooms} />}
      {view === 'energie' && <EnergyView />}
      {view === 'naechte' && <NightsView />}
    </div>
  );
}
