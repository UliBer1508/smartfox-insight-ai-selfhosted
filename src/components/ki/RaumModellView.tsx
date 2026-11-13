// Raummodell je Raum (12.11.2026): aus Protokoll › Raummodell hierher, damit es nur eine Ansicht gibt –
// eingeblendet im Plan (Auto-Steuerung › Plan › „Was der Planer über jeden Raum gelernt hat“).
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Room } from '@/types/room';
import { TZ } from './planerTeile';

const num = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ================================================================ Raummodell (02.11.2026; seit 12.11.2026 = Heizmodell des Planers)
// Vorher: eigenes Nacht-Modell (raum_abkuehlung / raum_modell, SQL 18) – nur aus wenigen Nächten ohne Heizen gelernt.
// Ersetzt durch das Heizmodell des Planers (heizmodell, täglich 03:00 aus 30 Tagen, doc/KONZEPT-PLANER-2026-11-06.md):
// Seit 13.11.2026 mit zwei Wärmespeichern (Estrich und Raumluft, param.v = 2): doc/FIX-PLANER-MODELL-2026-11-13.md.
// Altes Modell (ohne v): ΔT je Stunde = −k·(T − T_außen) + g·Estrich + s·PV_kW + c.
type HeizModell = { room_id: string; raum: string; param: { v?: number; k: number; g: number; s: number; c: number; tau?: number; r?: number; auf?: number } | null;
  fehler_12h: number | null; gleich_12h: number | null; heiz_std: number | null; prior: boolean | null; tage: number | null; gelernt_at: string | null };
type Voraus = { computed_at?: string; quelle?: string; aussen_nacht?: number | null; stunden_nacht?: number;
  rooms?: { room_id: string; name: string; current?: number; eco?: number; k?: number; c?: number; noetigAbends?: number; morgenOhneHeizen?: number; nachtBedarf?: number }[] };

// Abfall in h Stunden ohne Heizen ab T bei Außentemperatur a: Ziel ist T∞ = a + c/k.
// Neues Modell: Raumluft und Estrich kühlen gemeinsam aus, also langsamer (k / (1 + r)).
const abfall = (p: HeizModell['param'], t: number, a: number, h = 10) => {
  if (!p || !(p.k > 0)) return null;
  const tInf = a + (p.c || 0) / p.k;
  const rate = p.v === 2 ? p.k / (1 + (p.r ?? 0)) : p.k;
  return (t - tInf) * (1 - Math.exp(-rate * h));
};
const aufheizen = (p: HeizModell['param']) => (p ? (p.v === 2 ? p.auf ?? null : p.g) : null);

export function RaumModellView({ rooms }: { rooms: Room[] }) {
  const db = supabase as any;
  const [modell, setModell] = useState<HeizModell[]>([]);
  const [voraus, setVoraus] = useState<Voraus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, v] = await Promise.all([
      db.from('heizmodell').select('room_id, raum, param, fehler_12h, gleich_12h, heiz_std, prior, tage, gelernt_at'),
      supabase.from('system_settings').select('value').eq('key', 'raum_vorausschau').maybeSingle(),
    ]);
    const prio = new Map(rooms.map((r) => [r.id, r.priority ?? 99]));
    setModell(((m.data ?? []) as HeizModell[]).sort((x, y) => (prio.get(x.room_id) ?? 99) - (prio.get(y.room_id) ?? 99)));
    setVoraus((v.data?.value as Voraus) ?? null);
    setLoading(false);
  }, [db, rooms]);
  useEffect(() => { load(); }, [load]);

  const vMap = new Map((voraus?.rooms ?? []).map((r) => [r.room_id, r]));
  const ecoOf = (id: string) => Number(rooms.find((r) => r.id === id)?.eco_temp ?? 21);
  const gelernt = modell.map((m) => m.gelernt_at).filter(Boolean).sort().pop();

  return (
    <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-medium">Raummodell · wie schnell kühlt und heizt jeder Raum?</h3>
          {gelernt && <span className="text-xs text-muted-foreground">gelernt {new Date(gelernt).toLocaleDateString('de-DE')} {timeOf(gelernt)}</span>}
        </div>
        <Hint>
          Das Heizmodell des Planers lernt jede Nacht um 3 Uhr aus den Messwerten je Raum: wie viel Wärme der Estrich
          speichert, wie schnell er sie an den Raum abgibt, wie schnell der Raum nach draußen auskühlt, wie schnell er beim
          Heizen wärmer wird (Aufheizen) und wie viel die Sonne bringt. Räume mit wenig Heizdaten lehnen sich an die anderen
          Räume an. Daraus rechnet die Steuerung,
          wie warm ein Raum abends sein muss, damit er morgens ohne Heizen noch Eco hat.
        </Hint>
        {voraus?.computed_at && (
          <p className="text-sm">
            Kommende Nacht: außen Ø <b>{num(voraus.aussen_nacht)} °C</b>, {num(voraus.stunden_nacht)} h
            <span className="text-muted-foreground"> · Stand {timeOf(voraus.computed_at)}{voraus.quelle !== 'heizmodell' ? ' (noch altes Modell)' : ''}</span>
          </p>
        )}
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : modell.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Heizmodell gelernt (Planer lernt täglich um 3 Uhr).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                  <th className="py-2 pr-3 font-medium">Raum</th>
                  <th className="py-2 px-2 font-medium text-right">−10 h bei 0 °C</th>
                  <th className="py-2 px-2 font-medium text-right">−10 h bei −10 °C</th>
                  <th className="py-2 px-2 font-medium text-right">Aufheizen</th>
                  <th className="py-2 px-2 font-medium text-right">Fehler 12 h</th>
                  <th className="py-2 px-2 font-medium text-right">jetzt</th>
                  <th className="py-2 px-2 font-medium text-right">abends nötig</th>
                  <th className="py-2 pl-2 font-medium text-right">morgen ohne Heizen</th>
                </tr>
              </thead>
              <tbody>
                {modell.map((m) => {
                  const eco = ecoOf(m.room_id);
                  const v = vMap.get(m.room_id);
                  const knapp = v?.morgenOhneHeizen != null && v.morgenOhneHeizen < eco;
                  const besser = m.fehler_12h != null && m.gleich_12h != null && m.fehler_12h < m.gleich_12h;
                  return (
                    <tr key={m.room_id} className="border-t">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {m.raum}{m.prior && <span className="ml-1 text-[11px] text-muted-foreground" title={`nur ${num(m.heiz_std)} h Heizdaten – an die anderen Räume angelehnt`}>angelehnt</span>}
                      </td>
                      <td className="py-2 px-2 text-right">{abfall(m.param, eco, 0) == null ? '–' : `${num(abfall(m.param, eco, 0))} °C`}</td>
                      <td className="py-2 px-2 text-right">{abfall(m.param, eco, -10) == null ? '–' : `${num(abfall(m.param, eco, -10))} °C`}</td>
                      <td className="py-2 px-2 text-right">{aufheizen(m.param) == null ? '–' : `${num(aufheizen(m.param))} °C/h`}</td>
                      <td className="py-2 px-2 text-right" title={`Modell ${num(m.fehler_12h)} °C · „bleibt gleich“ ${num(m.gleich_12h)} °C`}>
                        {m.fehler_12h == null ? '–' : `${num(m.fehler_12h)} °C`}{m.gleich_12h != null && <span className={`ml-1 text-[11px] ${besser ? 'text-success' : 'text-muted-foreground'}`}>({num(m.gleich_12h)})</span>}
                      </td>
                      <td className="py-2 px-2 text-right">{num(v?.current)}</td>
                      <td className="py-2 px-2 text-right">{v?.noetigAbends == null ? '–' : num(v.noetigAbends)}</td>
                      <td className={`py-2 pl-2 text-right ${knapp ? 'text-warning font-semibold' : ''}`}>{v?.morgenOhneHeizen == null ? '–' : num(v.morgenOhneHeizen)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Hint>
              „−10 h“: so viel kühlt der Raum in 10 Stunden ohne Heizen ab Eco aus. „Aufheizen“: so schnell wird er beim Heizen
              wärmer, Estrich und Raum zusammen (der Raum folgt dem Estrich verzögert). „Fehler 12 h“: mittlere Abweichung der Vorhersage über 12 Stunden, in Klammern
              zum Vergleich „Temperatur bleibt gleich“ – grün, wenn das Modell besser ist.
            </Hint>
          </div>
        )}
    </div>
  );
}
