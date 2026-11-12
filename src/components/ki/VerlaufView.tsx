// KI › Verlauf und Wirkung (12.11.2026): lädt energie_stunde / energie_tag (SQL 35) und die genehmigten KI-Vorschläge.
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EStunde, ETag, KiVorschlag, Periode, Vergleich, VerlaufAnsicht } from './VerlaufAnsicht';
import { bereich, heuteWien, vergleichAnker, verschieben, wienMs } from './verlaufZeit';

const db = supabase as any; // Tabellen aus SQL 35 noch nicht in types.ts
const ST = 'stunde, pv_kwh, verbrauch_kwh, heizung_kwh, netz_kwh, einspeisung_kwh, soc_ende';

async function stundenLaden(von: string, bis: string): Promise<EStunde[]> {
  const { data } = await db.from('energie_stunde').select(ST)
    .gte('stunde', new Date(wienMs(von)).toISOString()).lt('stunde', new Date(wienMs(bis)).toISOString()).order('stunde').limit(1000);
  return data ?? [];
}

export function VerlaufView() {
  const [periode, setPeriode] = useState<Periode>('woche');
  const [anker, setAnker] = useState(heuteWien());
  const [vergleich, setVergleich] = useState<Vergleich>('vor');
  const [alleTage, setAlleTage] = useState<ETag[]>([]);
  const [vorschlaege, setVorschlaege] = useState<KiVorschlag[]>([]);
  const [stunden, setStunden] = useState<EStunde[]>([]);
  const [vglStunden, setVglStunden] = useState<EStunde[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  const b = useMemo(() => bereich(periode, anker), [periode, anker]);
  const va = vergleichAnker(periode, anker, vergleich);
  const vb = useMemo(() => (va ? bereich(periode, va) : null), [periode, va]);
  const stuendlich = periode === 'tag' || periode === 'woche';

  // Tageswerte (alle – ein Jahr sind 365 Zeilen) und KI-Vorschläge einmal laden, alle 15 min neu
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [t, k] = await Promise.all([
        db.from('energie_tag').select('*').order('tag').limit(5000),
        db.from('ki_vorschlaege').select('entschieden_at, titel, alt_wert, entschieden_wert, einheit').eq('art', 'vorschlag').eq('status', 'genehmigt').order('entschieden_at'),
      ]);
      if (!alive) return;
      if (t.error) setFehler(t.error.message.includes('energie_tag') ? 'SQL 35 ist noch nicht ausgeführt.' : t.error.message);
      setAlleTage(t.data ?? []);
      setVorschlaege((k.data ?? []).filter((x: any) => x.entschieden_at).map((x: any) => ({
        ts: Math.floor(Date.parse(x.entschieden_at) / 1000), titel: String(x.titel ?? '').replace(/\?$/, ''),
        wert: `${x.alt_wert ?? '–'} → ${x.entschieden_wert ?? '–'}${x.einheit ? ` ${x.einheit}` : ''}`,
      })));
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Stundenwerte nur für Tag und Woche
  useEffect(() => {
    let alive = true;
    if (!stuendlich) { setStunden([]); setVglStunden([]); return; }
    (async () => {
      const [a, v] = await Promise.all([stundenLaden(b.von, b.bis), vb ? stundenLaden(vb.von, vb.bis) : Promise.resolve([])]);
      if (alive) { setStunden(a); setVglStunden(v); }
    })();
    return () => { alive = false; };
  }, [stuendlich, b.von, b.bis, vb?.von, vb?.bis]);

  if (fehler) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{fehler}</CardContent></Card>;
  const tage = alleTage.filter(t => t.tag >= b.von && t.tag < b.bis);
  const vglTage = vb ? alleTage.filter(t => t.tag >= vb.von && t.tag < vb.bis) : [];
  const naechster = verschieben(periode, anker, 1);
  return (
    <Card>
      <CardContent className="p-4">
        <VerlaufAnsicht periode={periode} setPeriode={setPeriode} titel={b.titel}
          zurueck={() => setAnker(verschieben(periode, anker, -1))}
          vor={bereich(periode, naechster).von <= heuteWien() ? () => setAnker(naechster) : null}
          vergleich={vergleich} setVergleich={setVergleich} vglTitel={vb?.titel ?? ''}
          stunden={stunden} vglStunden={vglStunden} tage={tage} vglTage={vglTage} alleTage={alleTage}
          vorschlaege={vorschlaege} vonMs={wienMs(b.von)} bisMs={wienMs(b.bis)} vglVonMs={vb ? wienMs(vb.von) : null} />
      </CardContent>
    </Card>
  );
}
