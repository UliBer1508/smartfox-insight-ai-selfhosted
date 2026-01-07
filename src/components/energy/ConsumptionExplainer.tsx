import { useConsumptionAnalysis } from '@/hooks/useConsumptionAnalysis';
import { Card, CardContent } from '@/components/ui/card';
import { Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsumptionExplainerProps {
  consumption: number | null;
  className?: string;
}

export function ConsumptionExplainer({ consumption, className }: ConsumptionExplainerProps) {
  const { activeConsumers, isLoading } = useConsumptionAnalysis(consumption);

  const formatPower = (power: number | null) => {
    if (power === null || power === undefined) return '-- W';
    if (power >= 1000) {
      return `${(power / 1000).toFixed(2)} kW`;
    }
    return `${Math.round(power)} W`;
  };

  return (
    <Card className={cn("bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20", className)}>
      <CardContent className="p-4">
        {/* Hauptanzeige Verbrauch */}
        <div className="flex flex-col items-center justify-center mb-3">
          <Home className="h-6 w-6 text-blue-500 mb-2" />
          <span className="text-xs text-muted-foreground">Verbrauch</span>
          <span className="text-lg font-bold text-blue-500">
            {formatPower(consumption)}
          </span>
        </div>

        {/* Aktive Verbraucher */}
        <div className="border-t border-blue-500/20 pt-3">
          <span className="text-xs text-muted-foreground block mb-2">Aktive Verbraucher</span>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Lade...</p>
          ) : activeConsumers.length === 0 || (consumption ?? 0) < 500 ? (
            <p className="text-sm text-muted-foreground">Keine erkannt</p>
          ) : (
            <div className="space-y-1.5">
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
        </div>
      </CardContent>
    </Card>
  );
}
