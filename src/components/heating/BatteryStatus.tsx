import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Battery, BatteryCharging, BatteryLow, BatteryFull, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BatteryStatusProps {
  soc: number | null;
  capacity: number;
  batteryPower?: number | null;
}

export function BatteryStatus({ soc, capacity, batteryPower }: BatteryStatusProps) {
  const isCharging = batteryPower != null && batteryPower < -50;     // negativ = laden
  const isDischarging = batteryPower != null && batteryPower > 50;   // positiv = entladen

  const getBatteryIcon = () => {
    if (isCharging) return BatteryCharging;
    if (soc === null) return Battery;
    if (soc >= 80) return BatteryFull;
    if (soc <= 20) return BatteryLow;
    return Battery;
  };

  const getBatteryColor = () => {
    if (soc === null) return 'text-muted-foreground';
    if (soc >= 80) return 'text-energy-export';
    if (soc <= 20) return 'text-energy-import';
    return 'text-primary';
  };

  const getPowerColor = () => {
    if (isCharging) return 'text-energy-export';
    if (isDischarging) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  const Icon = getBatteryIcon();

  const formatPower = (power: number) => {
    const absPower = Math.abs(power);
    if (absPower >= 1000) {
      return `${(absPower / 1000).toFixed(1)} kW`;
    }
    return `${Math.round(absPower)} W`;
  };

  return (
    <Card className="overflow-hidden w-full max-w-full">
      <CardHeader className="pb-1 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2">
          <Icon className={cn('w-3.5 h-3.5 sm:w-4 sm:h-4', getBatteryColor())} />
          <span className="hidden sm:inline">Batterie-Status</span>
          <span className="sm:hidden">Batterie</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        <div className={cn('text-xl sm:text-2xl font-bold font-mono', getBatteryColor())}>
          {soc !== null ? `${soc.toFixed(0)}%` : '—'}
        </div>
        
        {/* Battery power display */}
        {batteryPower != null && (
          <div className={cn('flex items-center gap-1 text-xs sm:text-sm font-medium mt-0.5', getPowerColor())}>
            {isCharging ? (
              <>
                <ArrowUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Lädt: {formatPower(batteryPower)}</span>
              </>
            ) : isDischarging ? (
              <>
                <ArrowDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Entlädt: {formatPower(batteryPower)}</span>
              </>
            ) : (
              <>
                <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Standby</span>
              </>
            )}
          </div>
        )}
        
        <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
          <span className="hidden sm:inline">Kapazität: </span>{capacity} kWh
        </p>
        
        {/* Battery bar visualization */}
        {soc !== null && (
          <div className="mt-1.5 sm:mt-2 h-1.5 sm:h-2 bg-muted rounded-full overflow-hidden">
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
