import { Card, CardContent } from '@/components/ui/card';
import { TGP508Period } from '@/types/heating';
import { Sun, Battery, Moon, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HeatingPeriodCardProps {
  period: TGP508Period;
}

const iconMap = {
  sun: Sun,
  battery: Battery,
  moon: Moon,
  thermometer: Thermometer,
};

const colorMap = {
  sun: 'text-energy-export border-energy-export/30 bg-energy-export/10',
  battery: 'text-primary border-primary/30 bg-primary/10',
  moon: 'text-muted-foreground border-muted/50 bg-muted/20',
  thermometer: 'text-energy-import border-energy-import/30 bg-energy-import/10',
};

export function HeatingPeriodCard({ period }: HeatingPeriodCardProps) {
  const Icon = iconMap[period.icon];
  const colorClasses = colorMap[period.icon];

  return (
    <Card className={cn('border-2', colorClasses)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">
            Periode {period.period}
          </span>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="text-lg font-mono font-bold">
          {period.startTime} - {period.endTime}
        </div>
        
        <div className="text-3xl font-bold mt-1">
          {period.temperature}°C
        </div>
        
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {period.reason}
        </p>
      </CardContent>
    </Card>
  );
}
