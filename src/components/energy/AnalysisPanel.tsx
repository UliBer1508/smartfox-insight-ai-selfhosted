import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EnergyReading } from '@/types/energy';
import { Brain, TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnalysisPanelProps {
  readings: EnergyReading[];
  analysis: string | null;
  isAnalyzing: boolean;
  onAnalyzeDaily: (readings: EnergyReading[]) => void;
  onAnalyzeWeekly: () => void;
}

export function AnalysisPanel({ 
  readings, 
  analysis, 
  isAnalyzing, 
  onAnalyzeDaily,
  onAnalyzeWeekly 
}: AnalysisPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          KI-Musteranalyse
        </CardTitle>
        <CardDescription>
          Automatische Erkennung von Verbrauchsmustern und Optimierungsvorschläge
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <Button
            variant="outline"
            onClick={() => onAnalyzeDaily(readings)}
            disabled={isAnalyzing || readings.length < 10}
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <TrendingUp className="w-4 h-4 mr-2" />
            )}
            Tagesmuster analysieren
          </Button>
          
          <Button
            variant="outline"
            onClick={onAnalyzeWeekly}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Calendar className="w-4 h-4 mr-2" />
            )}
            Wochenvergleich
          </Button>
        </div>

        {analysis && (
          <div className={cn(
            'p-4 rounded-lg border bg-card',
            'prose prose-sm dark:prose-invert max-w-none'
          )}>
            <div className="flex items-start gap-3">
              <Brain className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {analysis}
              </div>
            </div>
          </div>
        )}

        {!analysis && !isAnalyzing && (
          <div className="text-center py-8 text-muted-foreground">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Klicke auf eine Analyse-Option, um Muster in deinen Energiedaten zu erkennen.</p>
          </div>
        )}

        {isAnalyzing && (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="w-12 h-12 mx-auto mb-3 animate-spin text-primary" />
            <p>Analysiere Energiedaten...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
