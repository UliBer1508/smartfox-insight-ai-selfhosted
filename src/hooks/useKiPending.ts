// Zählt, was im Tab KI auf eine Entscheidung wartet (Stand 26.10.2026):
//   - Parameter-Vorschläge im Modus "Vorschlag", weder übernommen noch abgelehnt (letzte 7 Tage,
//     nur der neueste je Parameter + Raum – Wiederholungen zählen nicht)
//   - offene KI-Batterie-Empfehlung
//   - offene Preis-Vorschläge (ÖMAG / Salzburg AG)
// Dazu der Zustand des KI-Autopiloten. Pollt alle 60 s.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { latestOpenDecisionIds } from '@/lib/aiParameters';

export interface KiPending {
  parameters: number;
  battery: number;
  prices: number;
  total: number;
  autopilotOn: boolean | null;
}

export function useKiPending(pollMs = 60_000): KiPending {
  const [state, setState] = useState<KiPending>({ parameters: 0, battery: 0, prices: 0, total: 0, autopilotOn: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [dec, wl, bat, pri, auto] = await Promise.all([
        supabase.from('ai_parameter_decisions')
          .select('id, parameter_key, parameter_scope, room_id, applied_at, auto_applied, decision_mode')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
        supabase.from('ai_parameter_whitelist').select('parameter_key, scope, autonomy_level').eq('enabled', true),
        supabase.from('battery_soc_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('price_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('system_settings').select('value').eq('key', 'ai_auto_mode_enabled').maybeSingle(),
      ]);
      const suggest = new Set((wl.data ?? []).filter(w => w.autonomy_level === 'suggest').map(w => `${w.scope}:${w.parameter_key}`));
      // Nur der neueste Vorschlag je Parameter + Raum zählt (der Advisor wiederholt offene stündlich)
      const parameters = latestOpenDecisionIds(dec.data ?? [], suggest).size;
      const battery = bat.count ?? 0;
      const prices = pri.count ?? 0;
      const av = auto.data?.value as { enabled?: boolean } | null | undefined;
      if (alive) setState({ parameters, battery, prices, total: parameters + battery + prices, autopilotOn: av?.enabled ?? null });
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs]);

  return state;
}
