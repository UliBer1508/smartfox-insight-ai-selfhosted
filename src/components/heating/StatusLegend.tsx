import { Flame, WifiOff, Hand, Sun, Leaf, Moon, Bot, Activity, CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger }  from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface LegendItem {
  icon: React.ReactNode;
  label: string;
  description: string;
  variant?: 'default' | 'outline' | 'destructive';
  customClass?: string;
}

export function StatusLegend() {
  const items: LegendItem[] = [
    {
      icon: <Flame className="h-3 w-3" />,
      label: 'Heizt',
      description: 'Thermostat heizt aktiv (Ventil offen, Strom fließt)',
      variant: 'destructive',
    },
    {
      icon: <WifiOff className="h-3 w-3" />,
      label: 'Offline',
      description: 'Keine Verbindung zum Thermostat – Werte sind veraltet',
      variant: 'outline',
      customClass: 'border-destructive text-destructive bg-destructive/10',
    },
    {
      icon: <Hand className="h-3 w-3" />,
      label: 'Manuell',
      description: 'Manuelle Überschreibung aktiv – Automatik blockiert bis Zeit abgelaufen',
    },
    {
      icon: <Bot className="h-3 w-3" />,
      label: 'KI',
      description: 'KI-Automatik steuert diesen Raum (kein PV-Modus)',
    },
    {
      icon: <Sun className="h-3 w-3" />,
      label: 'PV',
      description: 'PV-Modus aktiv – Überschuss wird zum Heizen genutzt',
    },
    {
      icon: <Leaf className="h-3 w-3" />,
      label: 'Eco',
      description: 'Energieeffiziente Grundtemperatur (Tagmodus, eingespart)',
      customClass: 'bg-green-500 text-white border-green-500',
    },
    {
      icon: <Moon className="h-3 w-3" />,
      label: 'Nacht',
      description: 'Nachttemperatur – Frostschutz oder reduzierte Wärme',
      customClass: 'bg-indigo-500 text-white border-indigo-500',
    },
    {
      icon: <CircleDot className="h-3 w-3" />,
      label: 'Estrich',
      description: 'Komfort wurde erreicht – Estrich speichert Wärme, Setpoint auf Eco',
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className="text-xs text-muted-foreground font-medium mr-1">Status:</span>
      {items.map((item, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              {item.variant ? (
                <Badge
                  variant={item.variant}
                  className={cn(
                    'text-[10px] h-5 gap-0.5 px-1.5 font-normal pointer-events-none',
                    item.customClass
                  )}
                >
                  {item.icon}
                  {item.label}
                </Badge>
              ) : (
                <span className={cn(
                  'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-normal text-foreground bg-muted/50 border-border',
                  item.customClass
                )}>
                  {item.icon}
                  {item.label}
                </span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px] text-center text-xs">
            <p>{item.description}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
