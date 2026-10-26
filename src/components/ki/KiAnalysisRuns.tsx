// KI › Auswertungen: Musteranalyse Tag / Woche / Monat auf Knopfdruck (Stand 26.10.2026).
// Herausgelöst aus dem früheren AnalysisPanel (Tab Verlauf & Muster). Zeitplan und Datenpflege
// stehen jetzt unter Einstellungen › KI (AnalysisScheduleSettings).
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Brain, Calendar, CalendarDays, Loader2, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EnergyReading } from '@/types/energy';

export function KiAnalysisRuns({ readings, analysis, isAnalyzing, onAnalyzeDaily, onAnalyzeWeekly }: {
  readings: EnergyReading[];
  analysis: string | null;
  isAnalyzing: boolean;
  onAnalyzeDaily: (readings: EnergyReading[]) => void;
  onAnalyzeWeekly: () => void;
}) {
  const [isMonthlyRunning, setIsMonthlyRunning] = useState(false);

  const runMonthlyAnalysis = async () => {
    setIsMonthlyRunning(true);
    try {
      const { error } = await supabase.functions.invoke('analyze-patterns', { body: { type: 'monthly_pattern' } });
      if (error) throw error;
      toast.success('Monatsanalyse gestartet');
    } catch (e) {
      toast.error('Monatsanalyse fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setIsMonthlyRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onAnalyzeDaily(readings)} disabled={isAnalyzing || readings.length < 10}>
          {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
          Tagesmuster auswerten
        </Button>
        <Button variant="outline" onClick={onAnalyzeWeekly} disabled={isAnalyzing}>
          {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
          Wochenvergleich
        </Button>
        <Button variant="outline" onClick={runMonthlyAnalysis} disabled={isMonthlyRunning}>
          {isMonthlyRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
          Monatsanalyse
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Laufen auch automatisch nach Zeitplan (Einstellungen › KI).</p>
      {isAnalyzing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Analysiere Energiedaten …</div>
      )}
      {analysis && (
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-primary mt-1 shrink-0" />
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{analysis}</div>
          </div>
        </div>
      )}
    </div>
  );
}
