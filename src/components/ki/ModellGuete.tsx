// „Wo stehen wir?“ › Lernt das Modell dazu? (25.11.2026, doc/PRUEFUNG-ESTRICH-MASSSTAB-2026-11-25.md)
// Uli: „Die KI soll über die Zeit lernen und das Modell verbessern, bis wir zu 100 % vorhersagen können, was unsere
// Aktionen bewirken.“ – Jede Nacht sagt das Modell von gestern die seither gemessenen Stunden 12 h voraus (nie gesehen).
// Maßstab „bleibt gleich“: Ist das Modell schlechter, hat es für diesen Raum noch nichts Brauchbares gelernt.
// Daten: heizmodell_guete (SQL 58, geschrieben von heizplaner aktion „lernen“ ~02:00).
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Zeile { tag: string; room_id: string; raum: string | null; fehler_12h: number | null; gleich_12h: number | null; n: number | null }

const TAGE = 14;
const n2 = (v: number | null | undefined) =>
  v == null || !isFinite(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mittel = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Kleine Verlaufslinie: Abweichung je Nacht, gestrichelt „bleibt gleich“ (Mittel). */
function Linie({ werte, gleich, gut }: { werte: (number | null)[]; gleich: number; gut: boolean }) {
  const W = 110, H = 22, da = werte.map(v => (v == null ? null : Number(v)));
  const mx = Math.max(gleich, ...da.filter((v): v is number => v != null)) * 1.15 || 1;
  const x = (i: number) => (werte.length < 2 ? W / 2 : (i / (werte.length - 1)) * W);
  const y = (v: number) => H - (v / mx) * H;
  const punkte = da.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1="0" x2={W} y1={y(gleich)} y2={y(gleich)} className="stroke-muted-foreground/50" strokeDasharray="3 3" strokeWidth="1" />
      {da.filter(v => v != null).length > 1
        ? <polyline points={punkte} fill="none" strokeWidth="1.5" className={gut ? 'stroke-emerald-600' : 'stroke-amber-600'} />
        : da.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2" className={gut ? 'fill-emerald-600' : 'fill-amber-600'} />)}
    </svg>
  );
}

export function ModellGuete() {
  const [zeilen, setZeilen] = useState<Zeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    const ab = new Date(Date.now() - (2 * TAGE + 1) * 86400000).toISOString().slice(0, 10);   // + Vorwoche zum Vergleich
    db.from('heizmodell_guete').select('tag, room_id, raum, fehler_12h, gleich_12h, n').gte('tag', ab).order('tag')
      .then(({ data, error }: { data: Zeile[] | null; error: { message: string } | null }) => {
        if (error) setFehler(error.message); else { setFehler(null); setZeilen(data ?? []); }
      });
  }, []);

  if (fehler) return <div className="text-sm text-red-600">Vorhersage-Güte nicht ladbar: {fehler}</div>;
  if (!zeilen) return <div className="text-sm text-muted-foreground">Lade Vorhersage-Güte …</div>;

  const kopf = (
    <div className="space-y-1">
      <div className="font-semibold">Lernt das Modell dazu?</div>
      <div className="text-sm text-muted-foreground">
        Wie genau hat das Modell von gestern die Raumtemperatur 12 h im Voraus getroffen – für Stunden, die es beim Lernen
        noch nicht kannte? Maßstab: „bleibt gleich“.
      </div>
    </div>
  );
  if (!zeilen.length) return (
    <div className="rounded-xl border bg-card p-4 space-y-2">{kopf}
      <div className="text-sm">Noch keine Werte – die erste Prüfung läuft beim nächtlichen Lernen (~02:00).</div>
    </div>
  );

  const tage = [...new Set(zeilen.map(z => z.tag))].sort();
  const letzter = tage[tage.length - 1];
  const fenster = tage.slice(-TAGE);
  const heute = zeilen.filter(z => z.tag === letzter && z.fehler_12h != null && z.gleich_12h != null);
  const fM = mittel(heute.map(z => Number(z.fehler_12h))), gM = mittel(heute.map(z => Number(z.gleich_12h)));
  const besser = heute.filter(z => Number(z.fehler_12h) < Number(z.gleich_12h)).length;
  // Vorwoche: Mittel der Nächte 7–13 Tage vor dem letzten Tag gegen die letzten 7 Nächte
  const tagNr = (iso: string) => Math.round(new Date(`${iso}T12:00:00Z`).getTime() / 86400000);
  const nL = tagNr(letzter);
  const fIn = (von: number, bis: number) => mittel(zeilen.filter(z => z.fehler_12h != null && nL - tagNr(z.tag) >= von && nL - tagNr(z.tag) <= bis).map(z => Number(z.fehler_12h)));
  const diese = fIn(0, 6), vorher = fIn(7, 13);
  const trend = isFinite(diese) && isFinite(vorher) ? diese - vorher : NaN;
  const genauer = isFinite(fM) && isFinite(gM) && gM > 0 ? Math.round(100 * (1 - fM / gM)) : NaN;
  const raeume = [...new Map(zeilen.map(z => [z.room_id, z.raum ?? '–'])).entries()]
    .map(([id, name]) => {
      const h = heute.find(z => z.room_id === id);
      const reihe = fenster.map(t => zeilen.find(z => z.room_id === id && z.tag === t)?.fehler_12h ?? null);
      const gl = mittel(zeilen.filter(z => z.room_id === id && z.gleich_12h != null && fenster.includes(z.tag)).map(z => Number(z.gleich_12h)));
      return { id, name, h, reihe, gl };
    })
    .sort((a, b) => Number(a.h?.fehler_12h ?? 9) - Number(b.h?.fehler_12h ?? 9));

  const Kachel = ({ label, wert, unter, ton }: { label: string; wert: string; unter: string; ton?: string }) => (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{wert}</div>
      <div className={`text-xs ${ton ?? 'text-muted-foreground'}`}>{unter}</div>
    </div>
  );

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        {kopf}
        <div className="text-xs text-muted-foreground whitespace-nowrap">geprüft {dm(letzter)}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kachel label="Abweichung 12 h" wert={`${n2(fM)} °C`}
          unter={isFinite(trend) ? `${trend <= 0 ? '−' : '+'}${n2(Math.abs(trend))} °C ggü. Vorwoche` : 'Vorwoche noch ohne Werte'}
          ton={isFinite(trend) ? (trend <= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400') : undefined} />
        <Kachel label="„bleibt gleich“" wert={`${n2(gM)} °C`}
          unter={isFinite(genauer) ? (genauer >= 0 ? `Modell ${genauer} % genauer` : `Modell ${-genauer} % ungenauer`) : '–'} />
        <Kachel label="Räume besser als „gleich“" wert={`${besser} von ${heute.length}`}
          unter={heute.length - besser > 0 ? `${heute.length - besser} ${heute.length - besser === 1 ? 'Raum' : 'Räume'} prüfen` : 'alle besser'}
          ton={heute.length - besser > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <caption className="sr-only">Vorhersage-Güte je Raum: Abweichung nach 12 h, Vergleich bleibt gleich, Verlauf</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Raum</th>
              <th className="py-1 pr-2 font-medium text-right">Modell</th>
              <th className="py-1 pr-2 font-medium text-right">gleich</th>
              <th className="py-1 px-3 font-medium">{fenster.length} {fenster.length === 1 ? 'Nacht' : 'Nächte'}</th>
              <th className="py-1 font-medium text-right">Stand</th>
            </tr>
          </thead>
          <tbody>
            {raeume.map(r => {
              const gut = r.h != null && Number(r.h.fehler_12h) < Number(r.h.gleich_12h);
              return (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 pr-2">{r.name}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{n2(r.h?.fehler_12h)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{n2(r.h?.gleich_12h)}</td>
                  <td className="py-1.5 px-3">{isFinite(r.gl) ? <Linie werte={r.reihe} gleich={r.gl} gut={gut} /> : null}</td>
                  <td className="py-1.5 text-right">
                    {r.h == null ? <span className="text-xs text-muted-foreground">ohne Wert</span>
                      : gut ? <span className="text-xs rounded px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">besser</span>
                        : <span className="text-xs rounded px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">prüfen</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">
        Geprüft jede Nacht vor dem Neu-Lernen (~02:00): Das Modell vom Vortag sagt jede Stunde seit seinem Lernen 12 h voraus
        und wird mit der gemessenen Temperatur verglichen. Linie = Abweichung je Nacht, gestrichelt = „bleibt gleich“.
        „Prüfen“: Für diesen Raum sagt das Modell schlechter voraus, als wenn man nichts vorhersagt – dort lernt es noch
        etwas Falsches. Ändert nichts an der Steuerung.
      </div>
    </div>
  );
}
