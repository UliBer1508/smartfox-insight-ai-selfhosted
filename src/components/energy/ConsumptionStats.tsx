import { Card, CardContent } from '@/components/ui/card';
import { Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsumptionStatsProps {
  consumption: number | null;
  className?: string;
}

export function ConsumptionStats({ consumption, className }: ConsumptionStatsProps) {
  const formatPower = (power: number | null) => {
    if (power === null || power === undefined) return '-- W';
    if (power >= 1000) {
      return `${(power / 1000).toFixed(2)} kW`;
    }
    return `${Math.round(power)} W`;
  };

  return (
    <Card className={cn("bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20", className)}>
      <CardContent className="p-4 flex flex-col items-center justify-center">
        <Home className="h-6 w-6 text-blue-500 mb-2" />
        <span className="text-xs text-muted-foreground">Verbrauch</span>
        <span className="text-lg font-bold text-blue-500">
          {formatPower(consumption)}
        </span>
      </CardContent>
    </Card>
  );
}
