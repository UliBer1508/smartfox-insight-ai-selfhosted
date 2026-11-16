// Haltezeiten gegen das Hin und Her der Sollwerte (Stufe A, 16.11.2026,
// doc/FIX-HIN-UND-HER-STUFE-A-2026-11-16.md).
// Uli: „Ich weiß nicht, was die richtige Haltezeit ist, die variiert im Laufe des Jahres.“
// Deshalb lernt SQL 46 beide Werte täglich aus den Messwerten (system_settings „haltezeiten“).
// Hier sieht man die gelernten Werte und kann sie überschreiben (system_settings „haltezeiten_vorgabe“,
// leer = automatisch). Dazu der Anteil „Hin und Her“ der letzten Tage (Ziel unter 2 %).
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FieldGrid, LabeledInput } from './SettingsBits';

const db = supabase as any; // haltezeiten / hin_und_her_tage (SQL 46) noch nicht in types.ts

type Gelernt = {
  halte_min?: number; pv_halten_min?: number; computed_at?: string;
  reaktion_p90_min?: number | null; reaktion_n?: number; einbruch_p90_min?: number | null; einbruch_n?: number;
};
type Vorgabe = { halte_min: number | null; pv_halten_min: number | null };
type Tag = { tag: string; befehle: number; hin_und_her: number; anteil: number | string };

const fmtStand = (iso?: string) => iso
  ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
  : '–';

export function HaltezeitenCard() {
  const [gelernt, setGelernt] = useState<Gelernt>({});
  const [vorgabe, setVorgabe] = useState<Vorgabe>({ halte_min: null, pv_halten_min: null });
  const [eingabe, setEingabe] = useState<{ halte: string; pv: string }>({ halte: '', pv: '' });
  const [tage, setTage] = useState<Tag[]>([]);
  const [saving, setSaving] = useState(false);

  const laden = async () => {
    const { data } = await db.from('system_settings').select('key, value').in('key', ['haltezeiten', 'haltezeiten_vorgabe']);
    const g = (data || []).find((d: any) => d.key === 'haltezeiten')?.value || {};
    const v = (data || []).find((d: any) => d.key === 'haltezeiten_vorgabe')?.value || {};
    const vg: Vorgabe = { halte_min: v.halte_min ?? null, pv_halten_min: v.pv_halten_min ?? null };
    setGelernt(g); setVorgabe(vg);
    setEingabe({ halte: vg.halte_min == null ? '' : String(vg.halte_min), pv: vg.pv_halten_min == null ? '' : String(vg.pv_halten_min) });
    const { data: t } = await db.rpc('hin_und_her_tage', { p_tage: 7 });
    setTage((t || []) as Tag[]);
  };
  useEffect(() => { laden(); }, []);

  // leer = automatisch; sonst ganze Minuten im erlaubten Bereich
  const parse = (s: string, min: number, max: number): number | null | 'ungueltig' => {
    if (s.trim() === '') return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : 'ungueltig';
  };
  const halte = parse(eingabe.halte, 0, 60);
  const pv = parse(eingabe.pv, 0, 60);
  const ungueltig = halte === 'ungueltig' || pv === 'ungueltig';
  const geaendert = !ungueltig && (halte !== vorgabe.halte_min || pv !== vorgabe.pv_halten_min);

  const speichern = async () => {
    if (ungueltig) return;
    setSaving(true);
    const { error } = await db.from('system_settings').upsert(
      { key: 'haltezeiten_vorgabe', value: { halte_min: halte, pv_halten_min: pv }, updated_at: new Date().toISOString() },
      { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error(`Nicht gespeichert: ${error.message}`); return; }
    toast.success('Haltezeiten gespeichert – gilt ab dem nächsten Lauf (≤ 2 min)');
    laden();
  };

  const heute = tage.length ? tage[tage.length - 1] : null;
  const badge = heute ? `Hin und Her heute ${Number(heute.anteil).toLocaleString('de-DE')} %` : undefined;

  return (
    <SectionCard id="haltezeiten" title="Haltezeiten" description="gegen das Hin und Her der Sollwerte" badge={badge}>
      <p className="text-sm text-muted-foreground">
        Ein Befehl an ein Thermostat wird nicht gleich wieder umgekehrt. Beide Zeiten lernt die Steuerung jede Nacht
        aus den Messwerten. Feld leer lassen = automatisch. Ausnahmen gelten immer: Raum unter Min, Raum über PV-Max,
        Ziel erreicht → aus, Leistungsdeckel, Sicherheit.
      </p>
      <FieldGrid>
        <div className="space-y-1">
          <LabeledInput label="Haltezeit" unit="min" inputMode="numeric" placeholder={`automatisch (${gelernt.halte_min ?? 10})`}
            value={eingabe.halte} invalid={halte === 'ungueltig'}
            onChange={(e) => setEingabe((s) => ({ ...s, halte: e.target.value }))} />
          <p className="text-xs text-muted-foreground">
            Gelernt: <strong>{gelernt.halte_min ?? 10} min</strong> – so lange braucht ein Thermostat nach dem Befehl
            in 9 von 10 Fällen, bis es heizt ({gelernt.reaktion_n ?? 0} Messungen, 7 Tage).
            {vorgabe.halte_min != null && <> Aktiv: eigene Vorgabe {vorgabe.halte_min} min.</>}
          </p>
        </div>
        <div className="space-y-1">
          <LabeledInput label="PV-Zusage halten" unit="min" inputMode="numeric" placeholder={`automatisch (${gelernt.pv_halten_min ?? 10})`}
            value={eingabe.pv} invalid={pv === 'ungueltig'}
            onChange={(e) => setEingabe((s) => ({ ...s, pv: e.target.value }))} />
          <p className="text-xs text-muted-foreground">
            Gelernt: <strong>{gelernt.pv_halten_min ?? 10} min</strong> – kurze Einbrüche der Einspeisung (Wolke,
            Warmwasser) dauern in 9 von 10 Fällen höchstens {gelernt.einbruch_p90_min != null ? Number(gelernt.einbruch_p90_min).toLocaleString('de-DE') : '–'} min
            ({gelernt.einbruch_n ?? 0} Einbrüche, 14 Tage). So lange behält ein Raum sein PV-Budget.
            {vorgabe.pv_halten_min != null && <> Aktiv: eigene Vorgabe {vorgabe.pv_halten_min} min.</>}
          </p>
        </div>
      </FieldGrid>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={speichern} disabled={!geaendert || saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Speichern
        </Button>
        {ungueltig && <span className="text-xs text-destructive">0 bis 60 min oder leer (= automatisch)</span>}
        <span className="text-xs text-muted-foreground ml-auto">Gelernt am {fmtStand(gelernt.computed_at)}</span>
      </div>
      {tage.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm">Hin und Her (Befehl A → B → A innerhalb 15 min), Ziel unter 2 %</div>
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 text-xs text-muted-foreground">
            {tage.map((t) => (
              <div key={t.tag} className="contents">
                <span>{new Date(`${t.tag}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                <span>{t.hin_und_her} von {t.befehle} Befehlen</span>
                <span className={Number(t.anteil) < 2 ? 'text-emerald-600' : 'text-amber-600'}>{Number(t.anteil).toLocaleString('de-DE')} %</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
