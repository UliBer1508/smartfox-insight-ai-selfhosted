// Anwesenheits-Kalender (29.10.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md, Abschnitt 7)
// Einstellungen › Anwesenheit: Monat / Woche / Tag wie in der Hausverwaltung.
// - Monat: Tagesstreifen je Monat. Volle Tage kräftig, An-/Abreisetage hell, leer grau.
//   Leeren Tag antippen = Anreise, zweiten Tag antippen = Abreise (Standard-Uhrzeiten aus
//   Haus › Anwesenheit), Uhrzeit im Formular pro Aufenthalt änderbar.
// - Woche: 7 Spalten 0–24 Uhr mit Vorlauf (schraffiert), Anwesenheit und Nacht.
// - Tag: 24-h-Leiste und Ablauf als Text.
// Gespeichert wird wie bisher in presence_periods (usePresence) – pv-automation bleibt unverändert.
// Rechnet in der Ortszeit des Geräts (wie die Eingabefelder), Haus und Geräte liegen in derselben Zeitzone.
import { CSSProperties, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2 } from 'lucide-react';
import { HeatingSettings } from '@/types/heating';
import { usePresence, PresencePeriod } from '@/hooks/usePresence';
import { SectionCard } from '@/components/settings/SettingsBits';

type CalSettings = Pick<HeatingSettings,
  'presence_control_enabled' | 'presence_lead_hours' | 'presence_arrival_time' | 'presence_departure_time' |
  'night_start_time' | 'night_end_time'> | null;

type View = 'monat' | 'woche' | 'tag';
type Kind = 'leer' | 'an' | 'ab' | 'voll';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const HOUR = 3600_000;
const WEEK_PX = 480; // Höhe der Wochenspalten (24 h → 20 px je Stunde)

const VORLAUF_BG = 'repeating-linear-gradient(45deg, rgb(245 192 78) 0 6px, rgb(251 225 166) 6px 12px)';
const KIND_CLASS: Record<Kind, string> = {
  voll: 'bg-primary',
  an: 'bg-primary/40',
  ab: 'bg-primary/40',
  leer: 'bg-muted',
};
const KIND_LABEL: Record<Kind, string> = { voll: 'anwesend', an: 'Anreise', ab: 'Abreise', leer: 'leer' };

// ---------------------------------------------------------------- Datums-Helfer (Ortszeit)
const pad = (n: number) => String(n).padStart(2, '0');
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtD = (d: Date) => `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const fmtT = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mondayOf = (d: Date) => addDays(day0(d), -((d.getDay() + 6) % 7));
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** "HH:MM" oder "HH:MM:SS" → [Stunde, Minute]; ungültig → Ersatzwert */
function hm(v: string | null | undefined, fallback: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '')) ?? /^(\d{1,2}):(\d{2})/.exec(fallback)!;
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))];
}
const atTime = (d: Date, t: [number, number]) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), t[0], t[1]);
function isoWeek(d: Date): number {
  const t = addDays(day0(d), 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

interface Stay { p: PresencePeriod; s: number; e: number }
interface Seg { kind: 'vor' | 'da' | 'nacht'; a: number; b: number; label: string } // a, b = Anteil des Tages 0..1

function dayKind(D: Date, stays: Stay[]): { kind: Kind; stay: Stay | null } {
  const s = D.getTime(), e = addDays(D, 1).getTime();
  const hits = stays.filter((x) => x.s < e && x.e > s);
  if (hits.length === 0) return { kind: 'leer', stay: null };
  // Tag vollständig abgedeckt? (Einträge können sich überlappen)
  let cover = s;
  for (const h of [...hits].sort((a, b) => a.s - b.s)) {
    if (h.s > cover) break;
    cover = Math.max(cover, h.e);
  }
  if (cover >= e) return { kind: 'voll', stay: hits[0] };
  const arrival = hits.find((h) => h.s >= s);
  return arrival ? { kind: 'an', stay: arrival } : { kind: 'ab', stay: hits[0] };
}

function daySegments(D: Date, stays: Stay[], leadH: number, night: { from: [number, number]; to: [number, number] }): Seg[] {
  const s = D.getTime(), e = addDays(D, 1).getTime(), len = e - s;
  const frac = (t: number) => (Math.min(Math.max(t, s), e) - s) / len;
  const out: Seg[] = [];
  for (const x of stays) {
    const vs = x.s - leadH * HOUR;
    if (leadH > 0 && vs < e && x.s > s) out.push({ kind: 'vor', a: frac(vs), b: frac(x.s), label: `Vorlauf ab ${fmtT(new Date(vs))}` });
    if (x.s < e && x.e > s) {
      let label = 'Anwesend';
      if (x.s >= s) label = `Anreise ${fmtT(new Date(x.s))}`;
      else if (x.e < e) label = `Abreise ${fmtT(new Date(x.e))}`;
      out.push({ kind: 'da', a: frac(x.s), b: frac(x.e), label });
    }
  }
  const nf = atTime(D, night.from).getTime(), nt = atTime(D, night.to).getTime();
  if (nf > nt) {
    out.push({ kind: 'nacht', a: 0, b: frac(nt), label: 'Nacht' });
    out.push({ kind: 'nacht', a: frac(nf), b: 1, label: 'Nacht' });
  } else if (nf < nt) {
    out.push({ kind: 'nacht', a: frac(nf), b: frac(nt), label: 'Nacht' });
  }
  // Nacht liegt halbtransparent über der Anwesenheit – dort keinen zweiten Text darüberschreiben
  const da = out.filter((g) => g.kind === 'da');
  for (const g of out) {
    if (g.kind === 'nacht' && da.some((d) => d.a < g.b && d.b > g.a)) g.label = '';
  }
  return out.filter((g) => g.b > g.a);
}

const segStyle = (k: Seg['kind']): { className: string; style?: CSSProperties } => {
  if (k === 'vor') return { className: 'text-amber-950', style: { background: VORLAUF_BG } };
  if (k === 'da') return { className: 'bg-primary text-primary-foreground font-semibold' };
  return { className: 'bg-foreground/10 text-foreground/80' };
};

// ---------------------------------------------------------------- Komponente
export function PresenceCalendar({ settings }: { settings: CalSettings }) {
  const { periods, state, available, add, remove, update } = usePresence(settings);
  const leadH = Math.max(0, Math.min(72, Number(settings?.presence_lead_hours ?? 6) || 0));
  const arrT = hm(settings?.presence_arrival_time, '14:00');
  const depT = hm(settings?.presence_departure_time, '11:00');
  const night = { from: hm(settings?.night_start_time, '22:00'), to: hm(settings?.night_end_time, '08:00') };

  const [view, setView] = useState<View>('monat');
  const [monthBase, setMonthBase] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [dayDate, setDayDate] = useState(() => day0(new Date()));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const nowMs = now.getTime();
  const stays: Stay[] = useMemo(
    () => periods.map((p) => ({ p, s: new Date(p.start_at).getTime(), e: new Date(p.end_at).getTime() })).sort((a, b) => a.s - b.s),
    [periods],
  );
  const open = periods.filter((p) => new Date(p.end_at).getTime() > nowMs);
  const past = periods.filter((p) => new Date(p.end_at).getTime() <= nowMs).slice(-5).reverse();

  const pv = from ? new Date(from) : null;
  const pb = to ? new Date(to) : null;
  const isPicked = (D: Date) => {
    if (!pv || Number.isNaN(pv.getTime())) return false;
    if (pb && !Number.isNaN(pb.getTime())) return D >= day0(pv) && D <= day0(pb);
    return sameDay(D, pv);
  };

  const clearForm = () => { setFrom(''); setTo(''); setNote(''); setEditId(null); };

  const onDay = (D: Date, stay: Stay | null) => {
    if (stay) { setSelId(stay.p.id); setDayDate(D); return; }
    setSelId(null);
    if (editId || !from || to) {
      setEditId(null); setNote('');
      setFrom(toLocalInput(atTime(D, arrT))); setTo('');
      return;
    }
    const a = new Date(from);
    if (day0(D) <= day0(a)) { setFrom(toLocalInput(atTime(D, arrT))); setTo(toLocalInput(atTime(a, depT))); }
    else setTo(toLocalInput(atTime(D, depT)));
  };

  const startEdit = (p: PresencePeriod) => {
    setEditId(p.id); setSelId(p.id);
    setFrom(toLocalInput(new Date(p.start_at))); setTo(toLocalInput(new Date(p.end_at))); setNote(p.note ?? '');
  };

  const sIso = fromLocalInput(from), eIso = fromLocalInput(to);
  const canSave = !!sIso && !!eIso && new Date(eIso) > new Date(sIso);
  const submit = async () => {
    if (!sIso || !eIso) return;
    setBusy(true);
    const ok = editId
      ? await update(editId, { start_at: sIso, end_at: eIso, note: note.trim() || null })
      : await add(sIso, eIso, note.trim() || null, 'app');
    setBusy(false);
    if (ok) clearForm();
  };

  // ---------- Navigation
  const shift = (dir: number) => {
    if (view === 'monat') setMonthBase((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1));
    if (view === 'woche') setWeekStart((w) => addDays(w, 7 * dir));
    if (view === 'tag') setDayDate((d) => addDays(d, dir));
  };
  const goToday = () => {
    setMonthBase(new Date(now.getFullYear(), now.getMonth(), 1));
    setWeekStart(mondayOf(now));
    setDayDate(day0(now));
  };
  const lastMonth = new Date(monthBase.getFullYear(), monthBase.getMonth() + 2, 1);
  const weekEnd = addDays(weekStart, 6);
  const navLabel = view === 'monat'
    ? `${MON[monthBase.getMonth()]} – ${MON[lastMonth.getMonth()]} ${lastMonth.getFullYear()}`
    : view === 'woche'
      ? `KW ${isoWeek(weekStart)} · ${pad(weekStart.getDate())}.${pad(weekStart.getMonth() + 1)}. – ${pad(weekEnd.getDate())}.${pad(weekEnd.getMonth() + 1)}.${weekEnd.getFullYear()}`
      : `${WDL[dayDate.getDay()]}, ${dayDate.getDate()}. ${MON[dayDate.getMonth()]} ${dayDate.getFullYear()}`;

  // ---------- Ansichten
  const monthView = (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => {
        const first = new Date(monthBase.getFullYear(), monthBase.getMonth() + i, 1);
        const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const days = Array.from({ length: n }, (_, k) => new Date(first.getFullYear(), first.getMonth(), k + 1));
        const infos = days.map((D) => dayKind(D, stays));
        const cnt = infos.filter((x) => x.kind !== 'leer').length;
        return (
          <div key={first.toISOString()} className="rounded-lg border bg-background/50 p-3 sm:p-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h4 className="text-base font-semibold">{MON[first.getMonth()]} {first.getFullYear()}</h4>
              <span className="text-sm text-muted-foreground">{cnt ? `${cnt} ${cnt === 1 ? 'Tag' : 'Tage'} im Haus` : 'kein Aufenthalt'}</span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[620px] grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                {days.map((D, k) => {
                  const { kind, stay } = infos[k];
                  const picked = kind === 'leer' && isPicked(D);
                  const today = sameDay(D, now);
                  const selected = !!stay && stay.p.id === selId;
                  const label = `${WDL[D.getDay()]} ${D.getDate()}. ${MON[D.getMonth()]}: ${KIND_LABEL[kind]}`
                    + (kind === 'an' && stay ? ` ${fmtT(new Date(stay.s))}` : '')
                    + (kind === 'ab' && stay ? ` ${fmtT(new Date(stay.e))}` : '');
                  return (
                    <div key={k} className="flex flex-col items-stretch gap-1">
                      <span className={`text-center text-[11px] ${D.getDay() === 0 ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{D.getDate()}</span>
                      <button
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => onDay(D, stay)}
                        className={`h-10 rounded-[3px] transition-[filter] hover:brightness-95 ${picked ? 'bg-amber-200 outline outline-1 outline-dashed outline-amber-600 -outline-offset-1' : KIND_CLASS[kind]} ${today ? 'ring-2 ring-inset ring-foreground' : selected ? 'shadow-[inset_0_-4px_0_0_hsl(var(--foreground)/0.6)]' : ''}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekView = (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[720px]">
        <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
          <span />
          {weekDays.map((D) => {
            const today = sameDay(D, now);
            return (
              <button key={D.toISOString()} type="button" onClick={() => { setDayDate(D); setView('tag'); }}
                className={`py-2 px-1 text-center text-xs hover:bg-muted ${today ? 'font-bold text-primary border-b-2 border-primary' : ''}`}>
                <div>{WD[D.getDay()]} {pad(D.getDate())}.{pad(D.getMonth() + 1)}.</div>
                <div className="text-[11px] text-muted-foreground font-normal">{KIND_LABEL[dayKind(D, stays).kind]}</div>
              </button>
            );
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
          <div className="flex flex-col">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-10 pr-2 pt-0.5 text-right text-[10px] text-muted-foreground">{pad(i * 2)}:00</div>
            ))}
          </div>
          {weekDays.map((D) => {
            const today = sameDay(D, now);
            return (
              <div key={D.toISOString()} className={`relative border-l ${today ? 'bg-primary/5' : ''}`}
                style={{ height: WEEK_PX, backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 39px, hsl(var(--border)) 39px 40px)' }}>
                {daySegments(D, stays, leadH, night).map((g, k) => {
                  const st = segStyle(g.kind);
                  const h = (g.b - g.a) * WEEK_PX;
                  return (
                    <div key={k} className={`absolute left-[3px] right-[3px] rounded-[5px] px-1.5 py-1 text-[10px] leading-tight overflow-hidden ${st.className}`}
                      style={{ ...st.style, top: g.a * WEEK_PX, height: h }}>
                      {h >= 28 ? g.label : ''}
                    </div>
                  );
                })}
                {today && (
                  <div className="absolute left-0 right-0 h-0.5 bg-destructive"
                    style={{ top: ((nowMs - D.getTime()) / (addDays(D, 1).getTime() - D.getTime())) * WEEK_PX }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const dSegs = daySegments(dayDate, stays, leadH, night);
  const dKind = dayKind(dayDate, stays).kind;
  const ds = dayDate.getTime(), de = addDays(dayDate, 1).getTime();
  const events: { t: number; text: string }[] = [];
  for (const x of stays) {
    const vs = x.s - leadH * HOUR;
    if (leadH > 0 && vs >= ds && vs < de) events.push({ t: vs, text: 'Vorlauf beginnt – ab jetzt gilt das Haus als bewohnt, Räume gehen wieder auf Eco' });
    if (x.s >= ds && x.s < de) events.push({ t: x.s, text: `Anreise – normaler Heizbetrieb${x.p.note ? ` (${x.p.note})` : ''}` });
    if (x.e >= ds && x.e < de) events.push({ t: x.e, text: 'Abreise – Haus gilt als leer: Räume halten „Ohne PV“, Sonne lädt bis Eco, kein Komfort' });
  }
  events.push({ t: atTime(dayDate, night.to).getTime(), text: 'Nacht endet – Tagesstart, Räume werden neu bewertet' });
  events.push({ t: atTime(dayDate, night.from).getTime(), text: 'Nacht beginnt – Nachtbetrieb wie bisher' });
  events.sort((a, b) => a.t - b.t);
  const dayIsToday = sameDay(dayDate, now);
  const dayState = { voll: 'Ganzer Tag anwesend', an: 'Anreisetag', ab: 'Abreisetag', leer: 'Haus leer – jeder Tag wie ein Wartetag' }[dKind];

  const dayView = (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background/50 p-3 sm:p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <h4 className="text-base font-semibold">{WDL[dayDate.getDay()]}, {pad(dayDate.getDate())}.{pad(dayDate.getMonth() + 1)}.{dayDate.getFullYear()}</h4>
          <span className="text-sm text-muted-foreground">{dayState}</span>
        </div>
        <div className="relative h-14 rounded-md bg-muted overflow-hidden">
          {dSegs.map((g, k) => {
            const st = segStyle(g.kind);
            const w = (g.b - g.a) * 100;
            return (
              <div key={k} className={`absolute top-0 bottom-0 px-2 py-1.5 text-[11px] leading-tight overflow-hidden ${st.className}`}
                style={{ ...st.style, left: `${g.a * 100}%`, width: `${w}%` }}>
                {w >= 9 ? g.label : ''}
              </div>
            );
          })}
          {dayIsToday && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-destructive" style={{ left: `${((nowMs - ds) / (de - ds)) * 100}%` }} />
          )}
        </div>
        <div className="relative h-5 mt-1">
          {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
            <span key={h} className="absolute top-0 text-[10px] text-muted-foreground"
              style={{ left: `${(h / 24) * 100}%`, transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
              {pad(h)}:00
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-lg border p-3 sm:p-4">
        <div className="text-sm font-semibold mb-1">Ablauf an diesem Tag</div>
        {events.map((ev, k) => (
          <div key={k} className="grid grid-cols-[56px_1fr] gap-3 py-2 border-t text-sm first:border-t-0">
            <span className="font-semibold tabular-nums">{fmtT(new Date(ev.t))}</span>
            <span className="text-muted-foreground">{ev.text}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ---------- Liste
  const row = (p: PresencePeriod, isPast: boolean) => {
    const s = new Date(p.start_at), e = new Date(p.end_at);
    const running = s.getTime() <= nowMs && e.getTime() > nowMs;
    const nights = Math.round((day0(e).getTime() - day0(s).getTime()) / 86400_000);
    const vs = new Date(s.getTime() - leadH * HOUR);
    return (
      <div key={p.id}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm ${isPast ? 'opacity-60' : ''} ${p.id === selId ? 'border-primary/60 bg-primary/5' : ''}`}>
        <span className="w-1.5 self-stretch rounded-sm bg-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {fmtD(s)} {fmtT(s)} – {fmtD(e)} {fmtT(e)}
            {running && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/30">läuft</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {nights} {nights === 1 ? 'Nacht' : 'Nächte'}
            {!isPast && !running && leadH > 0 ? ` · Vorlauf ab ${fmtD(vs)} ${fmtT(vs)}` : ''}
            {p.note ? ` · ${p.note}` : ''}
          </div>
        </div>
        {!isPast && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => startEdit(p)}><Pencil className="w-4 h-4 mr-1" />Bearbeiten</Button>
            {running ? (
              <Button size="sm" variant="ghost" onClick={() => update(p.id, { end_at: new Date().toISOString() })}>Jetzt beenden</Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label="Eintrag löschen" onClick={() => { remove(p.id); if (editId === p.id) clearForm(); }}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </span>
        )}
      </div>
    );
  };

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-primary" />Anwesend</span>
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-primary/40" />An-/Abreisetag</span>
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: VORLAUF_BG }} />Vorlauf ({leadH} h)</span>
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-foreground/10" />Nacht</span>
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-muted border" />Haus leer</span>
      <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-amber-200 border border-dashed border-amber-600" />Neuer Eintrag</span>
    </div>
  );

  return (
    <SectionCard
      id="anwesenheit"
      title="Anwesenheit"
      icon={<CalendarDays className="w-5 h-5 text-primary" />}
      badge={available && state.enabled
        ? <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground">{state.away ? 'abwesend' : 'anwesend'}</span>
        : undefined}
      description="Trag ein, wann jemand im Haus ist. Außerhalb dieser Zeiten gilt das Haus als leer: Räume halten „Ohne PV“, Sonne lädt bis Eco, kein Komfort. Nachts unverändert. Im Monat: Anreisetag und dann Abreisetag antippen. Ein- und Ausschalten, Vorlauf und Standard-Uhrzeiten unter Haus › Anwesenheit."
    >
      {!available ? (
        <p className="text-sm text-warning">Kalender noch nicht eingerichtet – SQL <code>07_anwesenheit.sql</code> ausführen.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Ansicht" className="flex gap-1 rounded-lg bg-muted p-1">
              {(['monat', 'woche', 'tag'] as View[]).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={`h-9 min-w-[72px] rounded-md px-3 text-sm ${view === v ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {v === 'monat' ? 'Monat' : v === 'woche' ? 'Woche' : 'Tag'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Zurück" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm" className="h-10" onClick={goToday}>Heute</Button>
              <Button variant="outline" size="icon" aria-label="Weiter" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <span className="font-semibold">{navLabel}</span>
          </div>

          {legend}
          {view === 'monat' && monthView}
          {view === 'woche' && weekView}
          {view === 'tag' && dayView}

          <div className="space-y-2 pt-2">
            <div className="text-sm font-semibold">{editId ? 'Aufenthalt bearbeiten' : 'Neuer Aufenthalt'}</div>
            <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] items-end">
              <label className="space-y-1">
                <span className="block text-sm">Anreise</span>
                <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="block text-sm">Abreise</span>
                <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="block text-sm">Notiz</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Wochenende, Familie" />
              </label>
              <div className="flex gap-2">
                <Button onClick={submit} disabled={busy || !canSave}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CalendarPlus className="w-4 h-4 mr-1.5" />{editId ? 'Speichern' : 'Eintragen'}</>}
                </Button>
                {(from || to || editId) && <Button variant="outline" onClick={clearForm} disabled={busy}>Abbrechen</Button>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Beim Antippen im Kalender: Anreise {pad(arrT[0])}:{pad(arrT[1])}, Abreise {pad(depT[0])}:{pad(depT[1])} –
              Uhrzeit hier pro Aufenthalt änderbar. Vorlauf {leadH} h vor der Anreise.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Geplante Aufenthalte</div>
            {open.length === 0
              ? <p className="text-sm text-muted-foreground">Kein Aufenthalt eingetragen.</p>
              : open.map((p) => row(p, false))}
          </div>
          {past.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Zuletzt</div>
              {past.map((p) => row(p, true))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
