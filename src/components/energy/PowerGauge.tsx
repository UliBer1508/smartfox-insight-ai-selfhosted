import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

interface PowerGaugeProps {
  power: number;
  maxPower?: number;
  className?: string;
}

export function PowerGauge({ power, maxPower = 10000, className }: PowerGaugeProps) {
  const percentage = Math.min(Math.abs(power) / maxPower * 100, 100);
  const isImport = power > 0;
  const isExport = power < 0;

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div className="relative w-48 h-48">
        {/* Background circle */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="96"
            cy="96"
            r="88"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="12"
          />
          <circle
            cx="96"
            cy="96"
            r="88"
            fill="none"
            stroke={isExport ? 'hsl(var(--energy-export))' : isImport ? 'hsl(var(--energy-import))' : 'hsl(var(--energy-neutral))'}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${percentage * 5.5} 550`}
            className="transition-all duration-500"
          />
        </svg>
        
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={cn(
            'p-2 rounded-full mb-2',
            isExport ? 'bg-success/20 text-success' : 
            isImport ? 'bg-destructive/20 text-destructive' : 
            'bg-muted text-muted-foreground'
          )}>
            {isExport ? <ArrowUp className="w-6 h-6" /> : 
             isImport ? <ArrowDown className="w-6 h-6" /> : 
             <Minus className="w-6 h-6" />}
          </div>
          <span className="text-3xl font-bold font-mono">
            {Math.abs(power).toLocaleString('de-DE')}
          </span>
          <span className="text-sm text-muted-foreground">Watt</span>
        </div>
      </div>
      
      <div className={cn(
        'px-4 py-2 rounded-full text-sm font-medium',
        isExport ? 'bg-success/20 text-success' : 
        isImport ? 'bg-destructive/20 text-destructive' : 
        'bg-muted text-muted-foreground'
      )}>
        {isExport ? 'Einspeisung' : isImport ? 'Netzbezug' : 'Ausgeglichen'}
      </div>
    </div>
  );
}
