import { Card, CardContent } from '@/components/ui/card';
import { Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PowerStatsProps {
  pvPower: number | null;
  className?: string;
}

export function PowerStats({ pvPower, className }: PowerStatsProps) {
  const formatPower = (power: number | null) => {
    if (power === null || power === undefined) return '-- W';
    if (power >= 1000) {
      return `${(power / 1000).toFixed(2)} kW`;
    }
    return `${Math.round(power)} W`;
  };

  return (
    <Card className={cn("bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border-amber-500/20", className)}>
      <CardContent className="p-4 flex flex-col items-center justify-center">
        <Sun className="h-6 w-6 text-amber-500 mb-2" />
        <span className="text-xs text-muted-foreground">PV-Leistung</span>
        <span className="text-lg font-bold text-amber-500">
          {formatPower(pvPower)}
        </span>
      </CardContent>
    </Card>
  );
}
