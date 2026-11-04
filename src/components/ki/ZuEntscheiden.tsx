// KI › Zu entscheiden (04.11.2026) – alles, was die KI vorschlägt, an einem Platz, in einfachen Worten.
// Mockup von Uli freigegeben („passt“). Konzept: doc/KONZEPT-KI-VORSCHLAEGE-2026-11-02.md §9.
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { KiVorschlag, useKiVorschlaege } from '@/hooks/useKiVorschlaege';

const fmt = (v: number | null | undefined, einheit: string) => {
  if (v == null) return '–';
  const n = einheit === '°C' ? v.toFixed(1).replace('.', ',') : String(Math.round(v));
  return `${n} ${einheit}`;
};
const schritt = (einheit: string) => (einheit === '°C' ? 0.5 : einheit === 'W' ? 100 : 5);
const datum = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function VorschlagKarte({ v, nummer, onJa, onNein }: {
  v: KiVorschlag; nummer: number;
  onJa: (wert?: number) => Promise<void>; onNein: () => Promise<void>;
}) {
  const [aendern, setAendern] = useState(false);
  const [wert, setWert] = useState(String(v.neu_wert ?? ''));
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const rueck = v.art === 'ruecknahme';
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  const eigener = Number(String(wert).replace(',', '.'));

  return (
    <Card className={rueck ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : undefined}>
      <CardContent className="p-5 sm:p-6 space-y-3">
        <h3 className="text-lg font-semibold leading-snug">{rueck ? v.titel : `${nummer} · ${v.titel}`}</h3>
        {v.was && <p className="text-[15px] leading-relaxed"><strong>Was sich ändert:</strong> {v.was}</p>}
        {v.warum && <p className="text-[15px] leading-relaxed"><strong>Warum:</strong> {v.warum}</p>}
        {v.wirkung_text && <p className="text-[15px] leading-relaxed"><strong>Was es bringt – und kostet:</strong> {v.wirkung_text}</p>}
        {v.details && (
          <div className="text-xs text-muted-foreground">
            <button type="button" className="underline" onClick={() => setDetails((d) => !d)}>{details ? 'Rechnung ausblenden' : 'Rechnung zeigen'}</button>
            {details && <p className="mt-1 leading-relaxed">{v.details}</p>}
          </div>
        )}
        {!aendern ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="lg" disabled={busy} onClick={() => run(() => onJa())}>
              {rueck ? `Ja, zurück auf ${fmt(v.neu_wert, v.einheit)}` : 'Ja, übernehmen'}
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => setAendern(true)}>Anderen Wert</Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => run(onNein)}>{rueck ? 'Nein, so lassen' : 'Nein'}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/50 p-4">
            <div className="space-y-1.5">
              <Label htmlFor={`wert-${v.id}`}>Dein Wert in {v.einheit} ({fmt(v.min_wert, v.einheit)} bis {fmt(v.max_wert, v.einheit)})</Label>
              <Input id={`wert-${v.id}`} className="w-36 h-12 text-base" inputMode="decimal" type="number"
                step={schritt(v.einheit)} min={v.min_wert ?? undefined} max={v.max_wert ?? undefined}
                value={wert} onChange={(e) => setWert(e.target.value)} />
            </div>
            <Button size="lg" disabled={busy || !Number.isFinite(eigener)} onClick={() => run(() => onJa(eigener))}>
              {Number.isFinite(eigener) ? `${fmt(eigener, v.einheit)} übernehmen` : 'Übernehmen'}
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => setAendern(false)}>Abbrechen</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ZuEntscheiden() {
  const { offen, infos, paket, batterieLetzte, loading, fehler, genehmigen, ablehnen } = useKiVorschlaege();

  const gesternIso = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const paketAktuell = paket && paket.tag >= gesternIso;
  const batterieZeile = (() => {
    if (!batterieLetzte || offen.some((v) => v.batterieId)) return null;
    if (Date.now() - new Date(batterieLetzte.at).getTime() > 36 * 3600000) return null;
    if (batterieLetzte.proposed !== batterieLetzte.old) return null;
    const zeit = new Date(batterieLetzte.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `Batterie: um ${zeit} neu gerechnet – ${batterieLetzte.old} % passt.`;
  })();
  const zurInfo = [...(batterieZeile ? [batterieZeile] : []), ...infos.map((i) => i.titel)];

  const ja = (v: KiVorschlag) => async (wert?: number) => {
    const err = await genehmigen(v, wert);
    if (err) toast.error(`Nicht übernommen: ${err}`);
    else toast.success('Übernommen. Ich schaue mir die Wirkung die nächsten 3 Tage an.');
  };
  const nein = (v: KiVorschlag) => async () => {
    const err = await ablehnen(v);
    if (err) toast.error(`Fehler: ${err}`);
    else toast.info('Abgelehnt. Der Vorschlag kommt frühestens in 7 Tagen wieder.');
  };

  let nr = 0;
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-muted-foreground leading-relaxed">
        Die KI schaut sich jeden Morgen um 10 Uhr den Vortag an. Wenn sie etwas verbessern würde, steht es hier –
        in einfachen Worten. Geändert wird erst, wenn du Ja sagst.
      </p>

      {fehler && <Card className="border-destructive/40"><CardContent className="p-4 text-sm text-destructive">{fehler}</CardContent></Card>}

      <Card className="border-cyan-200 bg-cyan-50/60 dark:bg-cyan-950/20 dark:border-cyan-900">
        <CardContent className="p-5 text-[15px] leading-relaxed">
          {loading ? 'Lade …' : paketAktuell
            ? <><strong>Gestern ({datum(paket!.tag)}):</strong> {paket!.text}</>
            : paket
              ? <><strong>Letzter Rückblick ({datum(paket.tag)}):</strong> {paket.text}</>
              : 'Der erste Rückblick kommt morgen um 10:00.'}
        </CardContent>
      </Card>

      {!loading && offen.length === 0 && (
        <p className="text-[15px] py-2">Nichts zu entscheiden.</p>
      )}
      {offen.map((v) => (
        <VorschlagKarte key={v.id} v={v} nummer={v.art === 'ruecknahme' ? 0 : ++nr} onJa={ja(v)} onNein={nein(v)} />
      ))}

      {zurInfo.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-2">
            <h3 className="font-semibold">Zur Info – nichts zu tun</h3>
            {zurInfo.map((t, i) => <p key={i} className="text-[15px] leading-relaxed">• {t}</p>)}
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Was du früher entschieden hast, steht unter Protokoll › Ereignisse. Ein abgelehnter Vorschlag kommt frühestens nach 7 Tagen wieder.
      </p>
    </div>
  );
}
