import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Battery, BatteryCharging, BatteryLow, BatteryFull } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BatteryStatusProps {
  soc: number | null;
  capacity: number;
}

export function BatteryStatus({ soc, capacity }: BatteryStatusProps) {
  const getBatteryIcon = () => {
    if (soc === null) return Battery;
    if (soc >= 80) return BatteryFull;
    if (soc <= 20) return BatteryLow;
    return BatteryCharging;
  };

  const getBatteryColor = () => {
    if (soc === null) return 'text-muted-foreground';
    if (soc >= 80) return 'text-energy-export';
    if (soc <= 20) return 'text-energy-import';
    return 'text-primary';
  };

  const Icon = getBatteryIcon();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className={cn('w-4 h-4', getBatteryColor())} />
          Batterie-Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold font-mono', getBatteryColor())}>
          {soc !== null ? `${soc.toFixed(0)}%` : '—'}
        </div>
        <p className="text-xs text-muted-foreground">
          Kapazität: {capacity} kWh
        </p>
        
        {/* Battery bar visualization */}
        {soc !== null && (
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn(
                'h-full rounded-full transition-all duration-500',
                soc >= 80 ? 'bg-energy-export' : soc <= 20 ? 'bg-energy-import' : 'bg-primary'
              )}
              style={{ width: `${soc}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
