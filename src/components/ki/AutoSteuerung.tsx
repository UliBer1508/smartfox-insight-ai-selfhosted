// Tab „Auto-Steuerung“ (12.11.2026) – erstes Fenster, vor der Übersicht.
// Uli: „Die Auto-Steuerung soll das erste Fenster vor Übersicht sein. Wo sind die Steuerungselemente, und wie kann
// ich eingreifen, wenn die KI nicht richtig optimiert?“
// Aufbau (Uli 12.11.: Verlauf zuerst): 1 Verlauf und Wirkung (VerlaufView) · 2 Steuerung (Modus + Eingriffe) · 3 Plan (PlanerView).
// Die Eingriffe sind die vorhandenen Einstellungen, hier an einem Platz – keine neuen Werte.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Room } from '@/types/room';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useKiPending } from '@/hooks/useKiPending';
import { PlanerView } from './PlanerView';
import { VerlaufView } from './VerlaufView';
import { num } from './planerTeile';
import { Klappabschnitt } from '@/components/layout/Klappabschnitt';

type Modus = 'aus' | 'schatten' | 'steuern';

function Steuerung({ rooms, onNavigate }: { rooms: Room[]; onNavigate: (tab: 'overview' | 'ki' | 'settings') => void }) {
  const { settings, saveSettings } = useHeatingSettings();
  const pending = useKiPending();
  const s = settings as any;
  const [entwurf, setEntwurf] = useState<Record<string, number>>({});
  const wert = (k: string, def: number) => (entwurf[k] ?? Number(s[k] ?? def));
  const geaendert = Object.keys(entwurf).filter(k => entwurf[k] !== Number(s[k]));
  const modus: Modus = (s.planer_modus ?? 'schatten') as Modus;

  // Plan-Prüfung (13.11.2026): welche Räume der Planer gerade nicht steuert und warum (system_settings planer_pruefung)
  const [pruef, setPruef] = useState<Record<string, { ok: boolean; gruende: string[] }>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).from('system_settings').select('value').eq('key', 'planer_pruefung').maybeSingle();
      if (alive) setPruef(data?.value?.raeume ?? {});
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const jetzt = Date.now();
  const besonders = useMemo(() => rooms.map(r => {
    const manuell = r.manual_override_until && new Date(r.manual_override_until).getTime() > jetzt;
    const p = pruef[r.id];
    const grund = r.nicht_steuerbar_seit ? 'Thermostat nimmt keine Befehle an' : r.automation_enabled === false ? 'Automatik aus' : manuell
      ? `manuell bis ${new Date(r.manual_override_until as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      : p && !p.ok ? `Regel-Steuerung, Plan passt nicht (${p.gruende[0] ?? 'Prüfung'})` : null;
    return { id: r.id, name: r.name, grund };
  }).filter(x => x.grund), [rooms, jetzt, pruef]);

  // 13.11.2026: Modus schaltet nur Uli. Beim Umschalten rechnet der Planer sofort neu (nicht erst in bis zu 15 min),
  // damit „Steuern“ gleich mit einem frischen Plan beginnt und das Etikett im Plan stimmt.
  const modusSetzen = async (m: Modus) => {
    if (m === modus) return;
    const ok = await saveSettings({ planer_modus: m } as any);
    if (!ok || m === 'aus') return;
    const { error } = await supabase.functions.invoke('heizplaner', { body: { aktion: 'planen' } });
    if (error) toast.error('Neuer Plan konnte nicht sofort gerechnet werden – kommt mit dem nächsten 15-Minuten-Lauf.');
    else toast.success(m === 'steuern' ? 'Neuer Plan gerechnet – der Planer steuert ab dem nächsten Lauf (≤ 5 min).' : 'Neuer Plan gerechnet – Schattenbetrieb.');
  };

  const regler = [
    { k: 'planer_gewicht_ziel', def: 0.6, min: 0.1, max: 3, step: 0.1, l: 'Sparsamer ↔ wärmer',
      links: 'sparsamer', rechts: 'wärmer', text: (v: number) => `1 °C·h unter Normal ist dir ${num(v)} kWh Netzstrom wert. Höher = wärmer, mehr Netz. Min hält der Planer immer.` },
    { k: 'max_grid_heating_power_w', def: 4000, min: 1000, max: 8000, step: 250, l: 'Höchstleistung ohne Sonne',
      links: '1 kW', rechts: '8 kW', text: (v: number) => `${num(v / 1000)} kW dürfen gleichzeitig aus Batterie/Netz heizen.` },
    // 14.11.2026 (Uli): Min ist die Untergrenze, kein Wert darunter – der Regler „Sicherheit unter Untergrenze“ entfällt,
    // der Planer hält Min immer (doc/FIX-PLANER-MIN-HART-2026-11-14.md).
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Modus</div>
            <div className="text-xs text-muted-foreground">Wer setzt die Sollwerte der Thermostate?</div>
          </div>
          <div role="group" aria-label="Modus der Auto-Steuerung" className="flex bg-muted rounded-lg p-1 gap-0.5">
            {([['aus', 'Aus'], ['schatten', 'Schatten'], ['steuern', 'Steuern']] as [Modus, string][]).map(([m, l]) => (
              <button key={m} type="button"
                onClick={() => modusSetzen(m)}
                className={`px-4 py-2 rounded-md text-sm disabled:opacity-50 ${modus === m ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className={`rounded-lg px-3 py-2 text-sm ${modus === 'aus' ? 'bg-muted' : 'bg-primary/10'}`}>
          {modus === 'aus' && 'Planer aus – die Regeln der heutigen Steuerung entscheiden allein.'}
          {modus === 'schatten' && 'Schattenbetrieb – der Planer rechnet alle 15 min einen Plan und schreibt auf, was er anders gemacht hätte; an den Thermostaten ändert er nichts. Die heutige Regel-Steuerung (pv-automation) setzt weiter die Sollwerte. So sehen wir im Vergleich, ob der Plan besser wäre, bevor er steuern darf.'}
          {modus === 'steuern' && 'Der Planer setzt die Sollwerte (alle 15 min ein neuer Plan, umgesetzt alle 5 min). Sicherheit gilt weiter: manuell übersteuerte Räume, Automatik aus, Fühler in der Sonne und Thermostate ohne Befehlsannahme bleiben unberührt; kein Raum fällt unter Min (der Planer heizt rechtzeitig vorher, fällt ein Raum trotzdem darunter, heizt er sofort), keiner wird über PV-Max geheizt. Ist der Plan älter als 30 min, übernimmt die bisherige Regel-Steuerung. Jeder Plan wird je Raum gegen die Messwerte geprüft: Heizt er länger als nötig, aus dem Netz über das Ziel, oder übersteuerst du den Raum oft, steuert die Regel-Steuerung diesen Raum (mindestens 2 h) – der Modus bleibt. Zurück jederzeit mit „Schatten“.'}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Eingreifen, wenn die Optimierung nicht passt</div>
          <div className="grid md:grid-cols-2 gap-3">
            {regler.map(r => {
              const v = wert(r.k, r.def);
              return (
                <div key={r.k} className="rounded-lg border p-3 space-y-2">
                  <label htmlFor={r.k} className="text-[11px] uppercase tracking-wider text-muted-foreground">{r.l}</label>
                  <input id={r.k} type="range" min={r.min} max={r.max} step={r.step} value={v} className="w-full accent-primary"
                    onChange={e => setEntwurf(x => ({ ...x, [r.k]: Number(e.target.value) }))} />
                  <div className="flex justify-between text-[11px] text-muted-foreground"><span>{r.links}</span><span>{r.rechts}</span></div>
                  <div className="text-xs">{r.text(v)}</div>
                </div>
              );
            })}
          </div>
          {geaendert.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" onClick={async () => { if (await saveSettings(Object.fromEntries(geaendert.map(k => [k, entwurf[k]])) as any)) setEntwurf({}); }}>Übernehmen</Button>
              <Button size="sm" variant="ghost" onClick={() => setEntwurf({})}>Verwerfen</Button>
              <span className="text-xs text-muted-foreground">Der nächste Plan (spätestens in 15 min) rechnet damit.</span>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3 space-y-1">
            <div className="font-medium">Einzelne Räume</div>
            <div className="text-xs text-muted-foreground">Ein Raum kurz anders? In der Übersicht übersteuern – der Planer lässt ihn dann in Ruhe. Ganz raus: Automatik des Raums aus.</div>
            {besonders.length > 0 && <ul className="text-xs pt-1">{besonders.map(b => <li key={b.id}>{b.name}: {b.grund}</li>)}</ul>}
            <Button size="sm" variant="outline" className="mt-1" onClick={() => onNavigate('overview')}>Zu den Räumen</Button>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <div className="font-medium">KI-Vorschläge</div>
            <div className="text-xs text-muted-foreground">Die KI ändert nichts selbst. Was sie vorschlägt, genehmigst oder änderst du – die Wirkung steht unten im Verlauf.</div>
            <div className="text-xs pt-1">{pending.total > 0 ? `${pending.total} offen` : 'nichts offen'}</div>
            <Button size="sm" variant="outline" className="mt-1" onClick={() => onNavigate('ki')}>Zu den Vorschlägen</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AutoSteuerung({ rooms, onNavigate }: { rooms: Room[]; onNavigate: (tab: 'overview' | 'ki' | 'settings') => void }) {
  return (
    <div className="space-y-6">
      <Klappabschnitt id="auto-verlauf" n={1} titel="Verlauf und Wirkung" frage="Wird es besser – Netz, Haus, Batterie, Kosten – und was haben die KI-Vorschläge bewirkt?"><VerlaufView /></Klappabschnitt>
      <Klappabschnitt id="auto-steuerung" n={2} titel="Steuerung" frage="Wer entscheidet – und wie greife ich ein?"><Steuerung rooms={rooms} onNavigate={onNavigate} /></Klappabschnitt>
      <Klappabschnitt id="auto-plan" n={3} titel="Plan" frage="Was macht der Planer in den nächsten 24 Stunden?"><PlanerView rooms={rooms} /></Klappabschnitt>
    </div>
  );
}
