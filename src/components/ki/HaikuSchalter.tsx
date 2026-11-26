// Haiku-Prüfer an/aus + Bilanz (26.11.2026) – doc/KONZEPT-KI-HAIKU-2026-11-26.md
// Haiku läuft täglich 10:00 in ki-tagesanalyse nach den festen Regeln und meldet, was die Regeln nicht erklären.
// Hier: einschalten/ausschalten und sehen, ob es etwas bringt (Haiku gegen Regeln, letzte 28 Tage).
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any; // SQL 61 noch nicht in types.ts

type Zahlen = { vorgeschlagen?: number; genehmigt?: number; abgelehnt?: number; besser?: number; gleich?: number; schlechter?: number };
type Bilanz = {
  tage: number; aktiv: boolean | null; haiku: Zahlen; regeln: Zahlen;
  laeufe: number; laeufe_ok: number; plateau_meldungen: number; hinweise: number; kosten_usd: number;
};

const zeile = (z: Zahlen) =>
  `${z.vorgeschlagen ?? 0} Vorschläge, ${z.genehmigt ?? 0} genehmigt, davon ${z.besser ?? 0} besser · ${z.gleich ?? 0} gleich · ${z.schlechter ?? 0} schlechter`;

export function HaikuSchalter() {
  const [b, setB] = useState<Bilanz | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('ki_haiku_bilanz', { p_tage: 28 });
    if (!error) setB(data as Bilanz);
  }, []);
  useEffect(() => { load(); }, [load]);

  const schalten = async (aktiv: boolean) => {
    setBusy(true);
    try {
      const { data: alt } = await db.from('system_settings').select('value').eq('key', 'ki_haiku').maybeSingle();
      const value = { ...(alt?.value ?? { modell: 'claude-haiku-5-5' }), aktiv, geschaltet: new Date().toISOString() };
      const { error } = await db.from('system_settings').upsert({ key: 'ki_haiku', value }, { onConflict: 'key' });
      if (error) throw error;
      await db.rpc('protokoll_add', { p_kind: 'einstellung', p_room: null,
        p_title: `Haiku-Prüfer ${aktiv ? 'eingeschaltet' : 'ausgeschaltet'}`, p_detail: 'KI › Zu entscheiden' });
      toast.success(aktiv ? 'Haiku prüft ab morgen 10:00 mit.' : 'Haiku ist aus. Die festen Regeln laufen weiter.');
      await load();
    } catch (e: any) {
      toast.error(`Nicht geschaltet: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };

  if (!b) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Haiku prüft mit</h3>
          <Switch checked={b.aktiv === true} disabled={busy} onCheckedChange={schalten} aria-label="Haiku-Prüfer an/aus" />
        </div>
        <p className="text-[15px] text-muted-foreground leading-relaxed">
          Haiku (Sprach-KI) liest jeden Morgen nach den festen Regeln mit und meldet, was die Regeln nicht erklären.
          Haiku steuert nichts – Vorschläge kommen hierher, du entscheidest.
        </p>
        <div className="text-sm leading-relaxed space-y-0.5">
          <p><strong>Letzte {b.tage} Tage – Haiku:</strong> {zeile(b.haiku)}, {b.hinweise} Hinweise.</p>
          <p><strong>Feste Regeln:</strong> {zeile(b.regeln)}.</p>
          <p className="text-muted-foreground">
            {b.laeufe} Läufe ({b.laeufe_ok} ohne Fehler) · Kosten {b.kosten_usd.toFixed(2).replace('.', ',')} $
            {b.plateau_meldungen > 0 && ` · Haiku meldet ${b.plateau_meldungen}× „kaum noch Verbesserung“ – Ausschalten oder nur als Wächter prüfen.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
