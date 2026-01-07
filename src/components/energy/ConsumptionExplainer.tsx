import { useConsumptionAnalysis } from '@/hooks/useConsumptionAnalysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

interface ConsumptionExplainerProps {
  consumption: number | null;
}

export function ConsumptionExplainer({ consumption }: ConsumptionExplainerProps) {
  const { activeConsumers, isLoading } = useConsumptionAnalysis(consumption);

  // Always show the card, but with placeholder if no active consumers
  if (isLoading) {
    return (
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            Aktive Verbraucher
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Lade...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          Aktive Verbraucher
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activeConsumers.length === 0 || (consumption ?? 0) < 500 ? (
          <p className="text-sm text-muted-foreground">Keine erkannt</p>
        ) : (
          <div className="space-y-1">
            {activeConsumers.map((consumer, index) => {
              const Icon = consumer.icon;
              const powerKw = consumer.power >= 1000 
                ? `${(consumer.power / 1000).toFixed(1)} kW` 
                : `${consumer.power} W`;
              
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
