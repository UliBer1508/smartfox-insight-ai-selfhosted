import { useConsumptionAnalysis } from '@/hooks/useConsumptionAnalysis';
import { Card, CardContent } from '@/components/ui/card';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsumptionExplainerProps {
  consumption: number | null;
  className?: string;
}

export function ConsumptionExplainer({ consumption, className }: ConsumptionExplainerProps) {
  const { activeConsumers, isLoading } = useConsumptionAnalysis(consumption);

  return (
    <Card className={cn("bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20", className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-5 w-5 text-orange-500" />
          <span className="text-xs text-muted-foreground">Aktive Verbraucher</span>
        </div>
        
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade...</p>
        ) : activeConsumers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine erkannt</p>
        ) : (
          <div className="space-y-1.5">
            {activeConsumers.map((consumer, index) => {
              const Icon = consumer.icon;
              const isEstimate = consumer.reason.includes('~');
              const powerKw = consumer.power >= 1000 
                ? `${isEstimate ? '~' : ''}${(consumer.power / 1000).toFixed(1)} kW` 
                : `${isEstimate ? '~' : ''}${consumer.power} W`;
              
              return (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" style={{ color: consumer.color }} />
                    <span className="text-foreground text-xs">{consumer.name}</span>
                  </div>
                  <span className="font-medium text-xs" style={{ color: consumer.color }}>
                    {powerKw}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}