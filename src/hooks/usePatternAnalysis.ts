import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading, DailyPattern } from '@/types/energy';
import { toast } from 'sonner';

export function usePatternAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [dailyPatterns, setDailyPatterns] = useState<DailyPattern[]>([]);

  const loadDailyPatterns = useCallback(async () => {
    const { data, error } = await supabase
      .from('daily_patterns')
      .select('*')
      .order('date', { ascending: false })
      .limit(7);

    if (!error && data) {
      setDailyPatterns(data as DailyPattern[]);
    }
  }, []);

  const analyzeDailyPattern = useCallback(async (readings: EnergyReading[]) => {
    if (readings.length < 10) {
      toast.error('Nicht genug Daten für Analyse (mind. 10 Messungen)');
      return;
    }

    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: { readings, type: 'daily_pattern' },
      });

      if (error) throw error;

      setAnalysis(data.analysis);
      toast.success('Analyse abgeschlossen');
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Fehler bei der Analyse');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const analyzeWeeklyComparison = useCallback(async () => {
    if (dailyPatterns.length < 2) {
      toast.error('Nicht genug Tagesdaten für Wochenvergleich');
      return;
    }

    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: { readings: dailyPatterns, type: 'weekly_comparison' },
      });

      if (error) throw error;

      setAnalysis(data.analysis);
      toast.success('Wochenanalyse abgeschlossen');
    } catch (error) {
      console.error('Weekly analysis error:', error);
      toast.error('Fehler bei der Wochenanalyse');
    } finally {
      setIsAnalyzing(false);
    }
  }, [dailyPatterns]);

  const analyzeCurrentStatus = useCallback(async (reading: EnergyReading) => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: { 
          readings: {
            power_io: reading.power_io,
            energy_in: reading.energy_in,
            energy_out: reading.energy_out,
          }, 
          type: 'current' 
        },
      });

      if (error) throw error;

      setAnalysis(data.analysis);
    } catch (error) {
      console.error('Current status analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return {
    isAnalyzing,
    analysis,
    dailyPatterns,
    loadDailyPatterns,
    analyzeDailyPattern,
    analyzeWeeklyComparison,
    analyzeCurrentStatus,
    setAnalysis,
  };
}
