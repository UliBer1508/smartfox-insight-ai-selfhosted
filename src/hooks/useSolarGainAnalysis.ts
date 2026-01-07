import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AnalysisResult {
  roomId: string;
  name: string;
  status: string;
  sampleCount: number;
  solarGainObservations?: number;
  heatLossObservations?: number;
  calculatedSolarGainFactor?: number;
  calculatedHeatLossRate?: number;
  confidence?: number;
}

export function useSolarGainAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult[] | null>(null);

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-solar-gain');
      
      if (error) throw error;
      
      if (data.success) {
        setLastAnalysis(data.results);
        const analyzedCount = data.results.filter((r: AnalysisResult) => r.status === 'analyzed').length;
        const insufficientCount = data.results.filter((r: AnalysisResult) => r.status === 'insufficient_data').length;
        
        if (analyzedCount > 0) {
          toast.success(`Solar-Analyse abgeschlossen: ${analyzedCount} Räume analysiert`);
        } else if (insufficientCount > 0) {
          toast.info(`Noch nicht genug Daten für die Analyse. ${insufficientCount} Räume benötigen mehr Samples.`);
        }
        
        return data.results;
      } else {
        throw new Error(data.error || 'Analyse fehlgeschlagen');
      }
    } catch (error) {
      console.error('Solar gain analysis error:', error);
      toast.error('Fehler bei der Solar-Analyse');
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  return {
    isAnalyzing,
    lastAnalysis,
    runAnalysis,
  };
}
