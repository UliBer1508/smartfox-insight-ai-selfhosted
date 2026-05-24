import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BatterySocSuggestion {
  id: string;
  created_at: string;
  old_value: number;
  new_value: number;
  pv_forecast_kwh: number | null;
  avg_pv_7d_kwh: number | null;
  soc_end_of_day: number | null;
  reason_text: string | null;
  status: 'pending' | 'accepted' | 'dismissed';
  decided_at: string | null;
  decided_by: string | null;
}

export function useBatterySocSuggestions(pollMs = 30000) {
  const [pending, setPending] = useState<BatterySocSuggestion | null>(null);
  const [history, setHistory] = useState<BatterySocSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('battery_soc_suggestions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    const rows: BatterySocSuggestion[] = data ?? [];
    setHistory(rows);
    setPending(rows.find((r) => r.status === 'pending') ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  const decide = useCallback(async (suggestion_id: string, action: 'accept' | 'dismiss') => {
    try {
      const { data, error } = await supabase.functions.invoke('battery-soc-decision', {
        body: { suggestion_id, action },
      });
      if (error) throw error;
      if (action === 'accept') {
        toast.success(`Batterie-Gate auf ${data?.new_value}% gesetzt`);
      } else {
        toast.info('Vorschlag abgelehnt');
      }
      await load();
      return true;
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message ?? 'unbekannt'}`);
      return false;
    }
  }, [load]);

  return { pending, history, loading, decide, reload: load };
}
