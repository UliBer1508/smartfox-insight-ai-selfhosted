// Anwesenheit (Konzept 28.10.2026, umgedreht 01.11.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md §9)
// Grundzustand anwesend, der Kalender enthält Abwesenheiten.
// - PresenceQuick: Karte in der Übersicht mit Schnellschalter „Ich bin weg bis …“ / „Ich bin zurück“
// - PresenceCalendar: Kalender in Einstellungen › Anwesenheit (Monat/Woche/Tag, siehe PresenceCalendar.tsx)
// Schalter „Anwesenheit steuern“ und Vorlauf liegen in Einstellungen › Haus › Anwesenheit.
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Home, DoorOpen, Loader2 } from 'lucide-react';
import { HeatingSettings } from '@/types/heating';
import { usePresence } from '@/hooks/usePresence';

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
/** Vorschlag für „weg bis“: in einer Woche 14:00. */
function inOneWeek14(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(14, 0, 0, 0);
  return d;
}

type PresenceSettings = Pick<HeatingSettings, 'presence_control_enabled' | 'presence_lead_hours'> | null;

// ---------------------------------------------------------------- Übersicht
export function PresenceQuick({ settings }: { settings: PresenceSettings }) {
  const { state, available, isLoading, awayUntil, backNow } = usePresence(settings);
  const [editing, setEditing] = useState(false);
  const [until, setUntil] = useState(() => toLocalInput(inOneWeek14()));
  const [busy, setBusy] = useState(false);
  if (!available || isLoading) return null;

  const leadH = Number(settings?.presence_lead_hours ?? 6);
  let title: string;
  let text: string;
  if (!state.enabled) {
    title = 'Anwesenheit nicht gesteuert';
    text = 'Das Haus wird immer wie bewohnt geheizt (Einstellungen › Haus › Anwesenheit).';
  } else if (state.away) {
    title = `Abwesend bis ${fmtWhen(state.until)}`;
    text = `Räume halten „Ohne PV“, Sonne heizt bis Eco und dann Komfort. Normalbetrieb ab ${leadH} h vor der Rückkehr.`;
  } else if (state.inLead) {
    title = 'Rückkehr vorbereiten';
    text = `Vorlauf läuft – normaler Heizbetrieb. Rückkehr ${fmtWhen(state.until)}.`;
  } else {
    title = 'Anwesend';
    text = 'Normalbetrieb.' + (state.next ? ` Nächste Abwesenheit ab ${fmtWhen(state.next.start_at)}.` : '');
  }

  const submit = async () => {
    const iso = fromLocalInput(until);
    if (!iso) return;
    setBusy(true);
    const ok = await awayUntil(iso);
    setBusy(false);
    if (ok) setEditing(false);
  };
  const back = async () => {
    setBusy(true);
    await backNow();
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
                <span className="block text-xs text-muted-foreground">Ich bin weg bis</span>
                <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="w-auto" />
              </label>
              <Button size="sm" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Eintragen'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Abbrechen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {state.current.length > 0 ? (
                <Button size="sm" variant="default" onClick={back} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Home className="w-4 h-4 mr-1.5" />} Ich bin zurück
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
                  <DoorOpen className="w-4 h-4 mr-1.5" /> Ich bin weg bis …
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
// Kalender mit Monat/Woche/Tag (29.10.2026) – eigene Datei
export { PresenceCalendar } from './PresenceCalendar';
