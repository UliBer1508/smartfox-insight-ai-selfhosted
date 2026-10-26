// Einstellungen › KI: Wie selbstständig darf die KI je Parameter handeln? (Stand 26.10.2026)
// Vorher nur erreichbar, wenn man einen einzelnen Vorschlag in der Liste aufklappte.
import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AutonomyLevel, NOT_A_SETTING_KEYS, SOC_LOCKED_KEYS, WhitelistRow } from '@/lib/aiParameters';

const LEVEL_TEXT: Record<AutonomyLevel, string> = {
  shadow: 'Schatten – KI notiert nur',
  suggest: 'Vorschlag – du entscheidest',
  auto: 'Auto – KI wendet selbst an',
};

export function ParameterAutonomySettings() {
  const [rows, setRows] = useState<WhitelistRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase.from('ai_parameter_whitelist').select('*').eq('enabled', true).order('scope').order('parameter_key');
    setRows(((data ?? []) as unknown as WhitelistRow[]).filter(r => !SOC_LOCKED_KEYS.has(r.parameter_key) && !NOT_A_SETTING_KEYS.has(r.parameter_key)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const setLevel = async (r: WhitelistRow, level: AutonomyLevel) => {
    const { error } = await supabase.from('ai_parameter_whitelist').update({ autonomy_level: level }).eq('id', r.id);
    if (error) { toast.error(`Nicht gespeichert: ${error.message}`); return; }
    toast.success(`${r.description || r.parameter_key}: ${LEVEL_TEXT[level]}`);
    load();
  };

  if (loading) return <div className="text-sm text-muted-foreground">Lade …</div>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        „Auto“ wirkt nur, solange der KI-Autopilot eingeschaltet ist; bei schlechter Bewertung (Score unter −0,3) setzt die KI
        den Wert selbst zurück und stuft den Parameter für 24 h auf „Vorschlag“ herab. SOC-Grenzen laufen getrennt über die
        KI-Batterie-Empfehlung.
      </p>
      <div className="divide-y rounded-lg border">
        {rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.description || r.parameter_key}</div>
              <div className="text-xs text-muted-foreground font-mono">
                {r.parameter_key}{r.scope === 'room' ? ' · je Raum' : ''} · {r.min_value ?? '–'} … {r.max_value ?? '–'}
              </div>
            </div>
            <Select value={r.autonomy_level} onValueChange={(v) => setLevel(r, v as AutonomyLevel)}>
              <SelectTrigger className="w-60" aria-label={`Modus für ${r.parameter_key}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['shadow', 'suggest', 'auto'] as AutonomyLevel[]).map(l => <SelectItem key={l} value={l}>{LEVEL_TEXT[l]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
        {rows.length === 0 && <div className="p-3 text-sm text-muted-foreground">Keine Parameter freigegeben.</div>}
      </div>
    </div>
  );
}
