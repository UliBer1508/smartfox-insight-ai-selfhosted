// Zählt, was im Tab KI auf eine Entscheidung wartet (Stand 04.11.2026):
//   - offene KI-Vorschläge und Rücknahmen aus ki_vorschlaege (ki-tagesanalyse, KI › Zu entscheiden)
//   - offene KI-Batterie-Empfehlung
//   - offene Preis-Vorschläge (ÖMAG / Salzburg AG)
// Dazu der Zustand des KI-Autopiloten. Pollt alle 60 s.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const [kv, bat, pri, auto] = await Promise.all([
        (supabase as any).from('ki_vorschlaege').select('id', { count: 'exact', head: true })
          .eq('status', 'offen').neq('art', 'info').gte('created_at', since),
        supabase.from('battery_soc_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('price_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('system_settings').select('value').eq('key', 'ai_auto_mode_enabled').maybeSingle(),
      ]);
      const parameters = kv.count ?? 0;   // vor SQL 21: Fehler → 0
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
