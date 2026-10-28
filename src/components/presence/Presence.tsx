// Anwesenheit (Konzept 28.10.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md)
// - PresenceQuick: Karte in der Übersicht mit Schnellschalter „Ich bin da bis …“ / „Ich bin weg“
// - PresenceCalendar: Kalender in Einstellungen › Anwesenheit (Zeiträume, in denen jemand da ist)
// Schalter „Anwesenheit steuern“ und Vorlauf liegen in Einstellungen › Haus › Anwesenheit.
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Home, DoorOpen, CalendarPlus, Trash2, Loader2, CalendarDays } from 'lucide-react';
import { HeatingSettings } from '@/types/heating';
import { usePresence, PresencePeriod } from '@/hooks/usePresence';
import { SectionCard } from '@/components/settings/SettingsBits';

const TZ = 'Europe/Vienna';

const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '–';

/** Date → Wert für <input type="datetime-local"> (Ortszeit des Geräts). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Vorschlag für „bis“: kommender Sonntag 18:00 (heute Sonntag vor 16 Uhr → heute 18:00). */
function nextSunday18(): Date {
  const d = new Date();
  const add = d.getDay() === 0 ? (d.getHours() < 16 ? 0 : 7) : 7 - d.getDay();
  d.setDate(d.getDate() + add);
  d.setHours(18, 0, 0, 0);
  return d;
}

type PresenceSettings = Pick<HeatingSettings, 'presence_control_enabled' | 'presence_lead_hours'> | null;

// ---------------------------------------------------------------- Übersicht
export function PresenceQuick({ settings }: { settings: PresenceSettings }) {
  const { state, available, isLoading, arriveUntil, leaveNow } = usePresence(settings);
  const [editing, setEditing] = useState(false);
  const [until, setUntil] = useState(() => toLocalInput(nextSunday18()));
  const [busy, setBusy] = useState(false);
  if (!available || isLoading) return null;

  const leadH = Number(settings?.presence_lead_hours ?? 6);
  let title: string;
  let text: string;
  if (!state.enabled) {
    title = 'Anwesenheit nicht gesteuert';
    text = 'Das Haus wird immer wie bewohnt geheizt (Einstellungen › Haus › Anwesenheit).';
  } else if (state.away) {
    title = 'Abwesend';
    text = 'Räume halten „Ohne PV“, Sonne lädt bis Eco, kein Komfort.'
      + (state.next ? ` Nächster Aufenthalt ${fmtWhen(state.next.start_at)} (Vorlauf ${leadH} h).` : ' Kein Aufenthalt eingetragen.');
  } else if (state.inLead) {
    title = 'Ankunft vorbereiten';
    text = `Vorlauf läuft – Räume gehen wieder auf Eco. Anwesend bis ${fmtWhen(state.until)}.`;
  } else {
    title = 'Anwesend';
    text = `Normalbetrieb bis ${fmtWhen(state.until)}.`;
  }

  const submit = async () => {
    const iso = fromLocalInput(until);
    if (!iso) return;
    setBusy(true);
    const ok = await arriveUntil(iso);
    setBusy(false);
    if (ok) setEditing(false);
  };
  const leave = async () => {
    setBusy(true);
    await leaveNow();
    setBusy(false);
  };

  return (
    <Card className={state.enabled && state.away ? 'border-slate-400/50' : 'border-primary/40'}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Home className={`w-5 h-5 mt-0.5 shrink-0 ${state.enabled && state.away ? 'text-muted-foreground' : 'text-primary'}`} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Anwesenheit</div>
            <div className="font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{text}</div>
          </div>
        </div>
        {state.enabled && (
          editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-xs text-muted-foreground">Ich bin da bis</span>
                <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="w-auto" />
              </label>
              <Button size="sm" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Eintragen'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Abbrechen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={state.away ? 'default' : 'outline'} onClick={() => setEditing(true)} disabled={busy}>
                <Home className="w-4 h-4 mr-1.5" /> Ich bin da bis …
              </Button>
              {state.current.length > 0 && (
                <Button size="sm" variant="outline" onClick={leave} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <DoorOpen className="w-4 h-4 mr-1.5" />} Ich bin weg
                </Button>
              )}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Einstellungen
export function PresenceCalendar({ settings }: { settings: PresenceSettings }) {
  const { periods, state, available, add, remove, update } = usePresence(settings);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const open = periods.filter(p => new Date(p.end_at).getTime() > now);
  const past = periods.filter(p => new Date(p.end_at).getTime() <= now).slice(-5).reverse();

  const submit = async () => {
    const s = fromLocalInput(from);
    const e = fromLocalInput(to);
    if (!s || !e) return;
    setBusy(true);
    const ok = await add(s, e, note.trim() || null, 'app');
    setBusy(false);
    if (ok) { setFrom(''); setTo(''); setNote(''); }
  };

  const row = (p: PresencePeriod, isPast: boolean) => {
    const running = new Date(p.start_at).getTime() <= now && new Date(p.end_at).getTime() > now;
    return (
      <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm ${isPast ? 'opacity-60' : ''}`}>
        <span className="font-medium">{fmtWhen(p.start_at)} – {fmtWhen(p.end_at)}</span>
        {running && <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/30">läuft</span>}
        {p.note && <span className="text-muted-foreground">{p.note}</span>}
        {!isPast && (
          <span className="ml-auto flex gap-1">
            {running && (
              <Button size="sm" variant="ghost" onClick={() => update(p.id, { end_at: new Date().toISOString() })}>Jetzt beenden</Button>
            )}
            {!running && (
              <Button size="sm" variant="ghost" aria-label="Eintrag löschen" onClick={() => remove(p.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <SectionCard
      id="anwesenheit"
      title="Anwesenheit"
      icon={<CalendarDays className="w-5 h-5 text-primary" />}
      badge={available && state.enabled
        ? <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground">{state.away ? 'abwesend' : 'anwesend'}</span>
        : undefined}
      description="Trag ein, wann jemand im Haus ist. Außerhalb dieser Zeiten gilt das Haus als leer: Räume halten „Ohne PV“, Sonne lädt bis Eco, kein Komfort. Nachts unverändert. Ein- und Ausschalten sowie Vorlauf unter Haus › Anwesenheit."
    >
      {!available ? (
        <p className="text-sm text-warning">Kalender noch nicht eingerichtet – SQL <code>07_anwesenheit.sql</code> ausführen.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] items-end">
            <label className="space-y-1">
              <span className="block text-sm">Von</span>
              <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="block text-sm">Bis</span>
              <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="block text-sm">Notiz</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Wochenende, Familie" />
            </label>
            <Button onClick={submit} disabled={busy || !from || !to}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CalendarPlus className="w-4 h-4 mr-1.5" />Eintragen</>}
            </Button>
          </div>
          <div className="space-y-2">
            {open.length === 0
              ? <p className="text-sm text-muted-foreground">Kein Aufenthalt eingetragen.</p>
              : open.map(p => row(p, false))}
          </div>
          {past.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Zuletzt</div>
              {past.map(p => row(p, true))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
