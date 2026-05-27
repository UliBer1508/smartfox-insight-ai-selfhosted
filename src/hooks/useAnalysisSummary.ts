import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StatsRange = 'day' | 'week' | 'month';

export interface AnalysisStats {
  type: StatsRange;
  days_in_range: number;
  latest_scr: number;
  latest_coverage: number;
  latest_grid_import_kwh: number;
  latest_score: number;
  delta_scr: number;
  avg_scr: number;
  best_scr: number;
  worst_scr: number;
  avg_score: number;
  total_pv_kwh: number;
  total_grid_kwh: number;
  ml_avg_reward: number | null;
  ml_event_count: number;
  series: Array<{ date: string; scr: number; score: number }>;
}

export interface AnalysisSummaryCache {
  summary: string;
  stats: AnalysisStats | null;
  generated_at: string;
}

const STALE_MS: Record<StatsRange, number> = {
  day: 24 * 60 * 60 * 1000,        // 24h
  week: 7 * 24 * 60 * 60 * 1000,   // 7d
  month: 30 * 24 * 60 * 60 * 1000, // 30d
};

export function useAnalysisSummary(range: StatsRange) {
  const [data, setData] = useState<AnalysisSummaryCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('analysis-summary', {
        body: { type: range },
      });
      if (err) throw err;
      if (res?.ok) {
        setData({
          summary: res.summary,
          stats: res.stats,
          generated_at: res.generated_at,
        });
      } else {
        throw new Error(res?.error || 'Unbekannter Fehler');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [range]);

  const loadCached = useCallback(async () => {
    setLoading(true);
    try {
      const { data: row, error: err } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', `analysis_summary_${range}`)
        .maybeSingle();
      if (err) throw err;
      const cached = (row?.value as unknown as AnalysisSummaryCache) || null;
      if (cached) setData(cached);
      else setData(null);

      // Selbstheilung: bei fehlendem oder zu altem Cache automatisch neu generieren
      const ageMs = cached?.generated_at
        ? Date.now() - new Date(cached.generated_at).getTime()
        : Infinity;
      if (!cached || ageMs > STALE_MS[range]) {
        // Async, nicht await — loading bleibt sauber
        generate();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, generate]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  return { data, loading, generating, error, generate, reload: loadCached };
}
