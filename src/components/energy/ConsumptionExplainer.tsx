import { useState } from 'react';
import { useConsumptionAnalysis } from '@/hooks/useConsumptionAnalysis';
import { useConsumerLogging } from '@/hooks/useConsumerLogging';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Zap, ChevronDown, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsumptionExplainerProps {
  consumption: number | null;
  className?: string;
}

function formatPower(watts: number): string {
  if (watts >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`;
  }
  return `${watts} W`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function ConsumptionExplainer({ consumption, className }: ConsumptionExplainerProps) {
  const { activeConsumers, isLoading } = useConsumptionAnalysis(consumption);
  const [expandedConsumer, setExpandedConsumer] = useState<string | null>(null);
  
  // Automatisches Logging der erkannten Verbraucher
  useConsumerLogging(activeConsumers, consumption);

  return (
    <Card className={cn("bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20", className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-5 w-5 text-orange-500" />
          <span className="text-xs text-muted-foreground">Aktive Verbraucher</span>
        </div>
        
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade...</p>
        ) : activeConsumers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine erkannt</p>
        ) : (
          <div className="space-y-1.5">
            {activeConsumers.map((consumer, index) => {
              const Icon = consumer.icon;
              const isEstimate = consumer.reason.includes('~');
              const powerDisplay = `${isEstimate ? '~' : ''}${formatPower(consumer.power)}`;
              const hasDetails = consumer.details?.rooms && consumer.details.rooms.length > 0;
              const isExpanded = expandedConsumer === consumer.name;
              
              if (hasDetails) {
                return (
                  <Collapsible 
                    key={index} 
                    open={isExpanded}
                    onOpenChange={(open) => setExpandedConsumer(open ? consumer.name : null)}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between text-sm hover:bg-muted/50 rounded px-1 -mx-1 transition-colors">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" style={{ color: consumer.color }} />
                          <span className="text-foreground text-xs">{consumer.name}</span>
                          <ChevronDown 
                            className={cn(
                              "h-3 w-3 text-muted-foreground transition-transform",
                              isExpanded && "rotate-180"
                            )} 
                          />
                        </div>
                        <span className="font-medium text-xs" style={{ color: consumer.color }}>
                          {powerDisplay}
                        </span>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-1">
                      <div className="pl-5 space-y-1 border-l-2 border-orange-500/30 ml-1.5">
                        {consumer.details!.rooms.map((room) => (
                          <div key={room.room_id} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <Flame className="h-3 w-3 text-orange-400/70" />
                              <span className="text-muted-foreground">{room.room_name}</span>
                              <span className="text-muted-foreground/60 text-[10px]">
                                ({formatDuration(room.duration_min)})
                              </span>
                            </div>
                            <span className="font-medium text-orange-400/80">
                              {formatPower(room.power)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              }
              
              return (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" style={{ color: consumer.color }} />
                    <span className="text-foreground text-xs">{consumer.name}</span>
                  </div>
                  <span className="font-medium text-xs" style={{ color: consumer.color }}>
                    {powerDisplay}
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
