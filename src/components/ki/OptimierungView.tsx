// Auto-Steuerung › 1 „Wo stehen wir?“ (15.11.2026) – doc/OPTIMIERUNG-UEBERSICHT-2026-11-15.md
// Uli: „Im Moment sehe ich viele Zahlen, weiß aber nicht, was ich damit anfangen soll. Die Anzeige soll zeigen, wo wir
// sind, wo wir hinwollen und wie wir dahin kommen – was kostet der Netzstrom, was spart die PV, und Anweisungen, was
// wir ändern müssen (KI-Vorschläge).“ Mockup freigegeben 15.11.2026 („wir bauen sie so“).
// Daten: optimierung_woche() (SQL 44) für die letzten 7 vollen Tage, KI-Vorschläge aus ki_vorschlaege (useKiVorschlaege).
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useKiVorschlaege, KiVorschlag } from '@/hooks/useKiVorschlaege';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // optimierung_woche (SQL 44) noch nicht in types.ts

interface Summe {
  pv_kwh: number; verbrauch_kwh: number; heizung_kwh: number; netz_kwh: number; einspeisung_kwh: number;
  netz_leer_kwh: number; eigen_pct: number | null; netz_eur: number; einspeise_eur: number; ohne_pv_eur: number;
  pv_ersparnis_eur: number; heizung_netz_eur: number | null; heizung_anteil_pct: number | null;
  kwh_je_hgt: number | null; h_unter_min: number | null; h_unter_normal: number | null;
}
interface Tag { tag: string; kwh_je_hgt: number | null; aussen: number | null; h_unter_min: number | null }
interface Woche { von: string; bis: string; tage: number; kwh_je_hgt: number | null; netz_eur: number }
interface Daten {
  von: string; bis: string; tage: number; summe: Summe; tage_liste: Tag[]; wochen: Woche[];
  ziel: { kwh_je_hgt?: number } | null; planer_modus: 'aus' | 'schatten' | 'steuern' | null;
}
interface Wirkung { urteil?: string; note_vorher?: number; note_nachher?: number; kwh_je_hgt_vorher?: number | null; kwh_je_hgt_nachher?: number | null }
interface Entschieden { id: string; titel: string; entschieden_at: string; status: string; wirkung: Wirkung | null }

type Ampel = 'gut' | 'mittel' | 'schlecht' | 'neutral';
const AMPEL: Record<Ampel, { punkt: string; text: string }> = {
  gut: { punkt: 'bg-emerald-600', text: 'text-emerald-700 dark:text-emerald-400' },
  mittel: { punkt: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  schlecht: { punkt: 'bg-red-600', text: 'text-red-700 dark:text-red-400' },
  neutral: { punkt: 'bg-slate-400', text: 'text-muted-foreground' },
};

const n = (v: number | null | undefined, stellen = 0) =>
  v == null || !isFinite(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
const eur = (v: number | null | undefined) => `${n(v, 0)} €`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const wtag = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short' });

function AmpelKarte({ ampel, label, frage, children }: { ampel: Ampel; label: string; frage: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${AMPEL[ampel].punkt}`} aria-hidden="true" />
        <span className={`text-sm font-semibold ${AMPEL[ampel].text}`}>{label}</span>
      </div>
      <div className="font-semibold leading-snug">{frage}</div>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function ZielZeile({ titel, jetzt, ziel, breite, marke, farbe, hinweis, label }: {
  titel: string; jetzt: string; ziel: string; breite: number; marke?: number; farbe: string; hinweis?: React.ReactNode; label: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="font-semibold">{titel}</span>
        <span>jetzt <b>{jetzt}</b> → Ziel <b>{ziel}</b></span>
      </div>
      <div className="relative h-3 rounded-full bg-muted" role="img" aria-label={label}>
        <div className={`absolute inset-y-0 left-0 rounded-full ${farbe}`} style={{ width: `${Math.max(0, Math.min(100, breite))}%` }} />
        {marke != null && <div className="absolute -top-1 -bottom-1 w-[3px] rounded bg-foreground" style={{ left: `${marke}%` }} />}
      </div>
      {hinweis && <div className="text-xs text-muted-foreground">{hinweis}</div>}
    </div>
  );
}

function VorschlagKarte({ v, onJa, onNein }: { v: KiVorschlag; onJa: () => Promise<void>; onNein: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  return (
    <div className="rounded-xl border p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-semibold">{v.titel}</span>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{v.art === 'ruecknahme' ? 'Rücknahme' : 'Neu'}</span>
      </div>
      {v.was && <p className="text-sm"><b>Was:</b> {v.was}</p>}
      {v.warum && <p className="text-sm text-muted-foreground"><b className="text-foreground">Warum:</b> {v.warum}</p>}
      {v.wirkung_text && <p className="text-sm text-muted-foreground"><b className="text-foreground">Erwartet:</b> {v.wirkung_text}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" disabled={busy} onClick={() => run(onJa)}>Übernehmen</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(onNein)}>Ablehnen</Button>
      </div>
    </div>
  );
}

const urteilText = (w: Wirkung | null): { text: string; ampel: Ampel } => {
  if (!w) return { text: 'Wirkung wird nach 3 Tagen gemessen', ampel: 'neutral' };
  const kwh = w.kwh_je_hgt_vorher != null && w.kwh_je_hgt_nachher != null
    ? ` · ${n(w.kwh_je_hgt_vorher, 2)} → ${n(w.kwh_je_hgt_nachher, 2)} kWh je Heizgradtag` : '';
  const note = w.note_vorher != null ? ` · Tagesnote ${w.note_vorher} → ${w.note_nachher}` : '';
  if (w.urteil === 'besser') return { text: `hat geholfen${kwh}${note}`, ampel: 'gut' };
  if (w.urteil === 'schlechter') return { text: `hat nicht geholfen${kwh}${note}`, ampel: 'schlecht' };
  if (w.urteil === 'gleich') return { text: `keine klare Wirkung${kwh}${note}`, ampel: 'neutral' };
  return { text: 'nicht messbar (zu wenige Tage)', ampel: 'neutral' };
};

export function OptimierungView({ onNavigate }: { onNavigate: (tab: 'overview' | 'ki' | 'settings') => void }) {
  const [d, setD] = useState<Daten | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [entschieden, setEntschieden] = useState<Entschieden[]>([]);
  const [zielEdit, setZielEdit] = useState<string | null>(null);
  const ki = useKiVorschlaege();

  const laden = useCallback(async () => {
    const [{ data, error }, { data: e }] = await Promise.all([
      db.rpc('optimierung_woche', { p_bis: null, p_tage: 7 }),
      db.from('ki_vorschlaege').select('id, titel, entschieden_at, status, wirkung')
        .in('status', ['genehmigt', 'geaendert']).eq('art', 'vorschlag').order('entschieden_at', { ascending: false }).limit(5),
    ]);
    if (error) { setFehler(error.message); return; }
    setFehler(null); setD(data as Daten); setEntschieden((e ?? []) as Entschieden[]);
  }, []);
  useEffect(() => {
    laden();
    const t = setInterval(() => { if (document.visibilityState === 'visible') laden(); }, 30 * 60_000);
    return () => clearInterval(t);
  }, [laden]);

  if (fehler) return <div className="text-sm text-red-600">Übersicht nicht ladbar: {fehler}</div>;
  if (!d) return <div className="text-sm text-muted-foreground">Lade Übersicht …</div>;
  if (!d.tage) return <div className="text-sm text-muted-foreground">Für die letzten 7 Tage gibt es noch keine Tageswerte.</div>;

  const s = d.summe;
  const ziel = Number(d.ziel?.kwh_je_hgt ?? 2.0);
  const kwh = s.kwh_je_hgt != null ? Number(s.kwh_je_hgt) : null;
  const minJeNacht = s.h_unter_min != null ? Number(s.h_unter_min) / d.tage : null;
  const normalJeTag = s.h_unter_normal != null ? Number(s.h_unter_normal) / d.tage : null;

  const sonne: Ampel = s.eigen_pct == null ? 'neutral' : s.eigen_pct >= 95 ? 'gut' : s.eigen_pct >= 80 ? 'mittel' : 'schlecht';
  const heiz: Ampel = kwh == null ? 'neutral' : kwh <= ziel ? 'gut' : kwh <= ziel * 1.15 ? 'mittel' : 'schlecht';
  const min: Ampel = minJeNacht == null ? 'neutral' : minJeNacht <= 0.5 ? 'gut' : minJeNacht <= 5 ? 'mittel' : 'schlecht';
  const planer: Ampel = d.planer_modus === 'steuern' ? 'neutral' : 'mittel';

  // Fazit in einem Satz – aus denselben Ampeln
  const fazit: string[] = [];
  fazit.push(sonne === 'gut' ? 'Sonnenstrom nutzen wir fast ganz.' : 'Es geht noch Sonnenstrom ins Netz – hier ist etwas zu holen.');
  if (min === 'schlecht') fazit.push('Aber das Haus hält seine Temperaturen nicht: Räume lagen oft unter Min. Zuerst muss Min sicher sein, dann wird gespart.');
  else if (heiz !== 'gut') fazit.push('Sparen geht jetzt nur noch über weniger Heizstrom aus dem Netz – das soll der Planer schaffen.');
  else fazit.push('Der Heizstrom liegt im Ziel.');

  // Kostenbalken: Ersparnis PV | Netz Rest | Netz Heizung (Anteil geschätzt)
  const gesamt = Math.max(1, Number(s.ohne_pv_eur));
  const heizEur = Number(s.heizung_netz_eur ?? 0);
  const restEur = Math.max(0, Number(s.netz_eur) - heizEur);
  const pct = (x: number) => `${(100 * x / gesamt).toFixed(1)}%`;

  const wochen = d.wochen.filter(w => w.kwh_je_hgt != null && Number(w.kwh_je_hgt) > 0.3);
  const skala = Math.max(ziel * 1.6, ...wochen.map(w => Number(w.kwh_je_hgt)), ...d.tage_liste.map(t => Number(t.kwh_je_hgt ?? 0)));
  const hoehe = (v: number) => Math.round(150 * v / skala);
  const zielHoehe = hoehe(ziel);

  const zielSpeichern = async () => {
    const v = Number(String(zielEdit ?? '').replace(',', '.'));
    if (!isFinite(v) || v <= 0 || v > 10) { toast.error('Bitte eine Zahl zwischen 0 und 10 eingeben'); return; }
    const { error } = await db.from('system_settings').upsert({ key: 'optimierung_ziel', value: { ...(d.ziel ?? {}), kwh_je_hgt: v, gesetzt: new Date().toISOString().slice(0, 10) } }, { onConflict: 'key' });
    if (error) { toast.error(`Ziel nicht gespeichert: ${error.message}`); return; }
    toast.success('Ziel gespeichert'); setZielEdit(null); laden();
  };

  const offen = ki.offen.filter(v => v.art !== 'info');

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Letzte {d.tage} Tage · {dm(d.von)}–{dm(d.bis)}</div>
        <p className="text-lg md:text-xl font-semibold leading-snug">{fazit.join(' ')}</p>
      </div>

      {/* 1 Wo stehen wir? */}
      <section className="space-y-3" aria-labelledby="opt-wo">
        <h3 id="opt-wo" className="text-base md:text-lg font-semibold"><span className="text-muted-foreground">1</span> Wo stehen wir?</h3>
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="font-semibold">Was kostet uns der Strom – und was spart die PV?</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-xs text-muted-foreground">Ohne PV hätten wir gezahlt</div><div className="text-2xl font-bold text-muted-foreground">{eur(s.ohne_pv_eur)}</div><div className="text-xs text-muted-foreground">{n(s.verbrauch_kwh)} kWh Verbrauch</div></div>
            <div><div className="text-xs text-muted-foreground">PV hat gespart</div><div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">− {eur(s.pv_ersparnis_eur)}</div><div className="text-xs text-muted-foreground">{n(Number(s.pv_kwh) - Number(s.einspeisung_kwh))} kWh selbst genutzt</div></div>
            <div><div className="text-xs text-muted-foreground">Netzstrom gezahlt</div><div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{eur(s.netz_eur)}</div><div className="text-xs text-muted-foreground">{n(s.netz_kwh)} kWh aus dem Netz</div></div>
            <div><div className="text-xs text-muted-foreground">davon für die Heizung</div><div className="text-2xl font-bold text-amber-700 dark:text-amber-400">ca. {eur(s.heizung_netz_eur)}</div><div className="text-xs text-muted-foreground">geschätzt nach Anteil ({n(s.heizung_anteil_pct)} %)</div></div>
          </div>
          <div className="flex h-4 rounded overflow-hidden" role="img" aria-label={`Von ${eur(s.ohne_pv_eur)} ohne PV: ${eur(s.pv_ersparnis_eur)} durch PV gespart, ${eur(restEur)} Netz für Haus, Warmwasser und Auto, ${eur(heizEur)} Netz für Heizung`}>
            <div className="bg-emerald-600" style={{ width: pct(Number(s.pv_ersparnis_eur)) }} />
            <div className="bg-blue-300" style={{ width: pct(restEur) }} />
            <div className="bg-amber-500" style={{ width: pct(heizEur) }} />
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-600" aria-hidden="true" />durch PV gespart</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-300" aria-hidden="true" />Netz: Haus, Warmwasser, Auto</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500" aria-hidden="true" />Netz: Heizung – hier setzt die Steuerung an</span>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <AmpelKarte ampel={sonne} label={sonne === 'gut' ? 'Gut' : 'Noch Potenzial'} frage="Nutzen wir den Sonnenstrom ganz?">
            {n(s.eigen_pct)} % des Sonnenstroms bleiben im Haus, {n(s.einspeisung_kwh, 1)} kWh gingen ins Netz.
          </AmpelKarte>
          <AmpelKarte ampel={heiz} label={heiz === 'gut' ? 'Im Ziel' : 'Hier liegt das Potenzial'} frage="Wie viel Strom braucht die Heizung?">
            <b className="text-foreground">{n(kwh, 1)} kWh je Heizgradtag</b> – unser Maß, unabhängig vom Wetter. Ziel {n(ziel, 1)}.
          </AmpelKarte>
          <AmpelKarte ampel={min} label={min === 'gut' ? 'Gehalten' : min === 'mittel' ? 'Fast gehalten' : 'Nicht gehalten'} frage="Bleiben alle Räume über Min?">
            {n(s.h_unter_min)} Raum-Stunden unter Min (Ø {n(minJeNacht, 1)} je Nacht), tagsüber {n(normalJeTag)} Raum-Stunden je Tag unter Normal.
          </AmpelKarte>
          <AmpelKarte ampel={planer} label={d.planer_modus === 'steuern' ? 'Wird geprüft' : 'Planer rechnet nur mit'} frage="Steuert der Planer besser als die Regeln?">
            {d.planer_modus === 'steuern'
              ? 'Der Planer steuert. Ob er besser ist, zeigt der Verlauf unten: kWh je Heizgradtag Woche für Woche.'
              : 'Die Regeln steuern, der Planer rechnet nur mit. Erst mit „Steuern“ kann er zeigen, ob er besser ist.'}
          </AmpelKarte>
        </div>
      </section>

      {/* 2 Wohin wollen wir? */}
      <section className="space-y-3" aria-labelledby="opt-wohin">
        <h3 id="opt-wohin" className="text-base md:text-lg font-semibold"><span className="text-muted-foreground">2</span> Wohin wollen wir?</h3>
        <div className="rounded-xl border bg-card p-4 space-y-6">
          <ZielZeile titel="Heizstrom je Heizgradtag senken" jetzt={n(kwh, 1)} ziel={n(ziel, 1)}
            breite={kwh != null ? 100 * kwh / (ziel * 1.6) : 0} marke={100 / 1.6}
            farbe={heiz === 'gut' ? 'bg-emerald-600' : 'bg-amber-500'}
            label={`Heizstrom je Heizgradtag: jetzt ${n(kwh, 1)}, Ziel ${n(ziel, 1)}`}
            hinweis={<span className="flex flex-wrap items-center gap-2">
              Weniger ist besser, Strich = Ziel.
              {kwh != null && kwh > ziel && <>Im Ziel wären es rund {n(Number(s.heizung_kwh) * (1 - ziel / kwh))} kWh bzw. {eur(Number(s.heizung_kwh) * (1 - ziel / kwh) * Number(s.netz_eur) / Math.max(1, Number(s.netz_kwh)))} weniger in {d.tage} Tagen.</>}
              {zielEdit == null
                ? <button type="button" className="underline" onClick={() => setZielEdit(String(ziel).replace('.', ','))}>Ziel ändern</button>
                : <span className="flex items-center gap-1">
                    <label htmlFor="opt-ziel" className="sr-only">Ziel kWh je Heizgradtag</label>
                    <Input id="opt-ziel" className="h-8 w-20" value={zielEdit} onChange={e => setZielEdit(e.target.value)} />
                    <Button size="sm" className="h-8" onClick={zielSpeichern}>Speichern</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setZielEdit(null)}>Abbrechen</Button>
                  </span>}
            </span>} />
          <ZielZeile titel="Sonnenstrom im Haus nutzen" jetzt={`${n(s.eigen_pct)} %`} ziel="100 %"
            breite={Number(s.eigen_pct ?? 0)} farbe={sonne === 'gut' ? 'bg-emerald-600' : 'bg-amber-500'}
            label={`Sonnenstrom genutzt: ${n(s.eigen_pct)} Prozent, Ziel 100 Prozent`}
            hinweis={sonne === 'gut' ? 'Erreicht.' : undefined} />
          <ZielZeile titel="Kein Raum unter Min" jetzt={`${n(s.h_unter_min)} Raum-Stunden`} ziel="0"
            breite={minJeNacht != null ? Math.min(100, 100 * minJeNacht / 12) : 0}
            farbe={min === 'gut' ? 'bg-emerald-600' : min === 'mittel' ? 'bg-amber-500' : 'bg-red-600'}
            label={`Raum-Stunden unter Min: ${n(s.h_unter_min)} in ${d.tage} Nächten, Ziel 0`}
            hinweis="Die Grenze, die nie unterschritten werden darf – Sparen darf nicht auf Kosten von Min gehen." />
        </div>
      </section>

      {/* 3 Wie kommen wir dahin? */}
      <section className="space-y-3" aria-labelledby="opt-wie">
        <h3 id="opt-wie" className="text-base md:text-lg font-semibold"><span className="text-muted-foreground">3</span> Wie kommen wir dahin?</h3>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap justify-between items-baseline gap-2">
            <div className="font-semibold">Was du jetzt ändern solltest – Vorschläge der KI</div>
            <span className="text-xs text-muted-foreground">Die KI ändert nichts selbst. Wirkung wird 3 Tage nach Übernahme gemessen.</span>
          </div>
          {ki.loading ? <div className="text-sm text-muted-foreground">Lade Vorschläge …</div>
            : offen.length > 0
              ? offen.map(v => (
                  <VorschlagKarte key={v.id} v={v}
                    onJa={async () => { const e = await ki.genehmigen(v); if (e) toast.error(e); else { toast.success('Übernommen'); laden(); } }}
                    onNein={async () => { const e = await ki.ablehnen(v); if (e) toast.error(e); else toast.success('Abgelehnt'); }} />
                ))
              : <div className="text-sm space-y-2">
                  <div>Die KI hat gerade keinen Vorschlag.</div>
                  {ki.paket?.text && <div className="text-muted-foreground">Rückblick {dm(ki.paket.tag)}: {ki.paket.text}</div>}
                  {ki.infos.length > 0 && <ul className="list-disc pl-5 text-muted-foreground space-y-1">{ki.infos.slice(0, 3).map(i => <li key={i.id}>{i.titel}</li>)}</ul>}
                </div>}
          {entschieden.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="text-sm font-semibold">Haben frühere Vorschläge geholfen?</div>
              <ul className="text-sm space-y-1">
                {entschieden.map(e => { const u = urteilText(e.wirkung); return (
                  <li key={e.id} className="flex gap-2 items-start">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${AMPEL[u.ampel].punkt}`} aria-hidden="true" />
                    <span><span className="text-muted-foreground">{dm(e.entschieden_at.slice(0, 10))}</span> {e.titel} – <span className={AMPEL[u.ampel].text}>{u.text}</span></span>
                  </li>); })}
              </ul>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => onNavigate('ki')}>Alle Vorschläge und Hinweise</Button>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="font-semibold">So optimiert die Steuerung</div>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-muted/60 p-3"><div className="text-xs font-semibold text-muted-foreground">Sie weiß</div>Wie viel Sonne kommt (Prognose) und wie schnell jeder Raum auskühlt (Raummodell).</div>
            <div className="rounded-lg bg-muted/60 p-3"><div className="text-xs font-semibold text-muted-foreground">Sie hält ein</div>Nie unter Min. Normal, wenn Strom günstig da ist. Bis PV-Max nur mit Sonne.</div>
            <div className="rounded-lg bg-muted/60 p-3"><div className="text-xs font-semibold text-muted-foreground">Sie rechnet</div>Regelmäßig den Tagesplan mit dem wenigsten Netzstrom – bei Sonne Wärme in die Räume „laden“.</div>
          </div>
          <div className="space-y-1 text-sm">
            <div className="font-semibold">Was du drehen kannst</div>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><b className="text-foreground">Normal und Min je Raum</b> – je größer der Abstand, desto mehr kann der Planer verschieben. Faustwert: jedes Grad weniger spart etwa 6 % Heizstrom.</li>
              <li><b className="text-foreground">PV-Max je Raum</b> – wie viel Wärme bei Sonne „auf Vorrat“ in den Raum darf.</li>
              <li><b className="text-foreground">Steuerung „Steuern“</b> – nur dann plant der Planer selbst (Abschnitt Steuerung unten).</li>
            </ul>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => onNavigate('settings')}>Räume einstellen</Button>
          </div>
        </div>
      </section>

      {/* Verlauf */}
      <section className="rounded-xl border bg-card p-4 space-y-3" aria-labelledby="opt-verlauf">
        <div className="flex flex-wrap justify-between items-baseline gap-2">
          <h3 id="opt-verlauf" className="font-semibold">Kommen wir voran? Heizstrom je Heizgradtag</h3>
          <span className="text-xs text-muted-foreground">je {d.tage} Tage · niedriger ist besser · gestrichelt = Ziel {n(ziel, 1)}</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[480px] grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, wochen.length)}, minmax(0, 1fr))` }}
            role="img" aria-label={`Heizstrom je Heizgradtag: ${wochen.map(w => `${dm(w.von)}–${dm(w.bis)} ${n(w.kwh_je_hgt, 1)}`).join(', ')}. Ziel ${n(ziel, 1)}.`}>
            {wochen.map(w => { const v = Number(w.kwh_je_hgt); return (
              <div key={w.von} className="flex flex-col items-center gap-1">
                <span className="text-sm font-semibold">{n(v, 1)}</span>
                <div className="relative w-full h-[160px] flex items-end justify-center">
                  <div className={`w-10 rounded-t ${v <= ziel ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ height: hoehe(v) }} />
                  <div className="absolute -left-2 -right-2 border-t-2 border-dashed border-foreground/70" style={{ bottom: zielHoehe }} aria-hidden="true" />
                </div>
                <span className="text-xs text-muted-foreground">{dm(w.von)}–{dm(w.bis)}</span>
              </div>); })}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Diese {d.tage} Tage einzeln: {d.tage_liste.map(t => `${wtag(t.tag)} ${n(t.kwh_je_hgt, 1)}`).join(' · ')}. Zeiträume, in denen kaum geheizt wurde, fehlen.
        </div>
      </section>
    </div>
  );
}
