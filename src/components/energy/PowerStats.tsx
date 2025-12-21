import { Card, CardContent } from '@/components/ui/card';
import { Sun, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PowerStatsProps {
  pvPower: number | null;
  consumption: number | null;
  className?: string;
}

export function PowerStats({ pvPower, consumption, className }: PowerStatsProps) {
  const formatPower = (power: number | null) => {
    if (power === null || power === undefined) return '-- W';
    if (power >= 1000) {
      return `${(power / 1000).toFixed(2)} kW`;
    }
    return `${Math.round(power)} W`;
  };

  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <Card className="bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border-amber-500/20">
        <CardContent className="p-4 flex flex-col items-center justify-center">
          <Sun className="h-6 w-6 text-amber-500 mb-2" />
          <span className="text-xs text-muted-foreground">PV-Leistung</span>
          <span className="text-lg font-bold text-amber-500">
            {formatPower(pvPower)}
          </span>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
        <CardContent className="p-4 flex flex-col items-center justify-center">
          <Home className="h-6 w-6 text-blue-500 mb-2" />
          <span className="text-xs text-muted-foreground">Verbrauch</span>
          <span className="text-lg font-bold text-blue-500">
            {formatPower(consumption)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
