import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';
import { HeatingSettings, HeatingRecommendation, HeatingAnalysisResult } from '@/types/heating';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/dateUtils';

export function useHeatingAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<HeatingAnalysisResult | null>(null);
  const [recommendations, setRecommendations] = useState<HeatingRecommendation[]>([]);

  const loadRecommendations = useCallback(async () => {
    // WICHTIG: Lokales Datum für korrekte Zeitzonen-Behandlung
    const today = getLocalDateString();
    
    const { data, error } = await supabase
      .from('heating_recommendations')
      .select('*')
      .eq('date', today)
      .order('period_number', { ascending: true });

    if (!error && data) {
      setRecommendations(data as HeatingRecommendation[]);
    }
  }, []);

  const analyzeHeating = useCallback(async (
    readings: EnergyReading[], 
    heatingSettings: HeatingSettings
  ) => {
    if (readings.length < 5) {
      toast.error('Nicht genug Daten für Heizungsanalyse (mind. 5 Messungen)');
      return;
    }

    setIsAnalyzing(true);
    try {
      // Consumer-Logs für heute laden um Verbrauch korrekt zuzuordnen
      const today = getLocalDateString();
      const { data: consumerLogs } = await supabase
        .from('consumer_logs')
        .select('*')
        .gte('start_time', today)
        .order('start_time', { ascending: true });

      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: { 
          readings,
          heatingSettings,
          consumerLogs: consumerLogs || [],
          type: 'heating_optimization' 
        },
      });

      if (error) throw error;

      if (data.heatingPlan) {
        setAnalysisResult(data.heatingPlan);
        
        // Save recommendations to database
        const todaySave = getLocalDateString();
        for (const period of data.heatingPlan.periods) {
          await supabase
            .from('heating_recommendations')
            .upsert({
              date: todaySave,
              period_number: period.period,
              start_time: period.startTime,
              end_time: period.endTime,
              recommended_temp: period.temperature,
              reason: period.reason,
              expected_pv_surplus: data.heatingPlan.expectedPvSurplus,
              priority: period.icon === 'sun' ? 'heating' : period.icon === 'battery' ? 'battery' : 'conservation',
            }, { 
              onConflict: 'date,period_number' 
            });
        }
        
        await loadRecommendations();
        toast.success('Heizungsanalyse abgeschlossen');
      } else if (data.analysis) {
        // Fallback for text analysis
        setAnalysisResult({
          periods: [],
          summary: data.analysis,
          expectedPvSurplus: 0,
          batteryStrategy: '',
          recommendations: [],
        });
      }
    } catch (error) {
      console.error('Heating analysis error:', error);
      toast.error('Fehler bei der Heizungsanalyse');
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadRecommendations]);

  return {
    isAnalyzing,
    analysisResult,
    recommendations,
    loadRecommendations,
    analyzeHeating,
    setAnalysisResult,
  };
}
