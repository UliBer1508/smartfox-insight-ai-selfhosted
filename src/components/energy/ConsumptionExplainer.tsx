import { useConsumptionAnalysis } from '@/hooks/useConsumptionAnalysis';
import { Info } from 'lucide-react';

interface ConsumptionExplainerProps {
  consumption: number | null;
}

export function ConsumptionExplainer({ consumption }: ConsumptionExplainerProps) {
  const { activeConsumers, isLoading } = useConsumptionAnalysis(consumption);

  // Only show if there are active consumers and consumption is significant
  if (isLoading || activeConsumers.length === 0 || (consumption ?? 0) < 500) {
    return null;
  }

  return (
    <div className="bg-muted/50 rounded-lg p-3 border border-border">
      <div className="flex items-center gap-2 mb-2">
        <Info className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Aktive Verbraucher</span>
      </div>
      <div className="space-y-2">
        {activeConsumers.map((consumer, index) => {
          const Icon = consumer.icon;
          const powerKw = consumer.power >= 1000 
            ? `${(consumer.power / 1000).toFixed(1)} kW` 
            : `${consumer.power} W`;
          
          return (
            <div key={index} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: consumer.color }} />
                <span className="text-foreground">{consumer.name}</span>
                <span className="text-muted-foreground text-xs">({consumer.reason})</span>
              </div>
              <span className="font-medium" style={{ color: consumer.color }}>
                {powerKw}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
