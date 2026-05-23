import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Bot, Brain, ChevronDown, Clock, Activity, TrendingUp, Flame, Zap } from 'lucide-react';
import { Room } from '@/types/room';
import { useAIStats } from '@/hooks/useAIStats';
import { useActiveHeatingRooms } from '@/hooks/useActiveHeatingRooms';
import { useState } from 'react';
import { AIBadge } from '@/components/ui/AIBadge';

interface AIStatusWidgetProps {
  rooms: Room[];
  pvPower: number | null;
  soc: number | null;
}

function getAutomationStatus(
  rooms: Room[],
  pvPower: number | null,
  soc: number | null
): { icon: string; status: string; detail: string } {
  const heatingRooms = rooms.filter(r => r.is_heating);
  const automatedRooms = rooms.filter(r => r.automation_enabled);
  
  if (heatingRooms.length > 0) {
    const names = heatingRooms.slice(0, 3).map(r => r.name).join(', ');
    const suffix = heatingRooms.length > 3 ? ` +${heatingRooms.length - 3}` : '';
    return {
      icon: '🔥',
      status: `${heatingRooms.length} ${heatingRooms.length === 1 ? 'Raum heizt' : 'Räume heizen'}`,
      detail: names + suffix
    };
  }
  
  const pvKw = (pvPower ?? 0) / 1000;
  
  if (pvKw > 2) {
    return {
      icon: '☀️',
      status: 'PV-Überschuss',
      detail: 'KI prüft Heizoptionen'
    };
  }
  
  if (pvKw > 0.5) {
    return {
      icon: '⚡',
      status: 'Teilversorgung',
      detail: 'Temperaturen werden gehalten'
    };
  }
  
  if (soc !== null && soc > 50) {
    return {
      icon: '✅',
      status: 'Alle auf Temperatur',
      detail: `${automatedRooms.length} Räume automatisiert`
    };
  }
  
  return {
    icon: '🌙',
    status: 'Energiesparmodus',
    detail: 'KI optimiert Verbrauch'
  };
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std`;
  return `vor ${Math.floor(hours / 24)} Tag${Math.floor(hours / 24) > 1 ? 'en' : ''}`;
}

export function AIStatusWidget({ rooms, pvPower, soc }: AIStatusWidgetProps) {
  const { stats, isLoading } = useAIStats();
  const { activeRooms, totalHeatingPower, isLoading: isLoadingRooms } = useActiveHeatingRooms();
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  
  const status = getAutomationStatus(rooms, pvPower, soc);
  
  // Finde letzte KI-Aktion aus Räumen
  const lastChange = rooms
    .filter(r => r.last_auto_change)
    .sort((a, b) => new Date(b.last_auto_change!).getTime() - new Date(a.last_auto_change!).getTime())[0];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          KI-Steuerung
          <AIBadge active={rooms.some(r => r.automation_enabled)} className="ml-auto" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Aktueller Status */}
        <div>
          <div className="text-xl sm:text-2xl font-bold font-mono">
            {status.icon} {status.status}
          </div>
          <p className="text-xs text-muted-foreground">{status.detail}</p>
          {lastChange && lastChange.last_auto_change && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {lastChange.name} → {lastChange.target_temp}°C {getTimeAgo(lastChange.last_auto_change)}
            </p>
          )}
        </div>

        {/* Letzte Aktionen - Collapsible */}
        <Collapsible open={isActionsOpen} onOpenChange={setIsActionsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronDown className={`h-3 w-3 transition-transform ${isActionsOpen ? 'rotate-180' : ''}`} />
            <Flame className="h-3 w-3" />
            Aktive Heizungen ({activeRooms.length})
            {totalHeatingPower > 0 && (
              <span className="ml-auto font-medium text-foreground">
                {totalHeatingPower >= 1000 ? `${(totalHeatingPower / 1000).toFixed(1)} kW` : `${totalHeatingPower} W`}
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {isLoadingRooms ? (
              <p className="text-xs text-muted-foreground">Laden...</p>
            ) : activeRooms.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine aktive Heizung</p>
            ) : (
              activeRooms.map(room => (
                <div key={room.room_id} className="flex items-center gap-2 text-xs p-1 rounded bg-muted/30">
                  <Flame className="h-3 w-3 text-orange-500" />
                  <span className="font-medium">{room.room_name}</span>
                  <span className="text-muted-foreground">
                    {room.power >= 1000 ? `${(room.power / 1000).toFixed(1)} kW` : `${room.power} W`}
                  </span>
                  <span className="text-muted-foreground ml-auto flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    seit {room.duration_min} Min
                  </span>
                </div>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Lernfortschritt - Collapsible */}
        <Collapsible open={isStatsOpen} onOpenChange={setIsStatsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronDown className={`h-3 w-3 transition-transform ${isStatsOpen ? 'rotate-180' : ''}`} />
            <Brain className="h-3 w-3" />
            Lernfortschritt
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="grid grid-cols-2 gap-2 text-xs p-2 rounded bg-muted/30">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-primary" />
                <span className="font-bold">{stats.totalDecisions}</span>
                <span className="text-muted-foreground">Entscheidungen</span>
              </div>
              <div>
                <span className="font-bold">{stats.evaluatedPercent}%</span>
                <span className="text-muted-foreground ml-1">evaluiert</span>
              </div>
              <div>
                <span className="font-bold">{stats.avgConfidence}%</span>
                <span className="text-muted-foreground ml-1">Ø Konfidenz</span>
              </div>
              <div>
                <span className="font-bold">{stats.roomCount}</span>
                <span className="text-muted-foreground ml-1">Räume</span>
              </div>
              {stats.avgReward !== 0 && (
                <div className="col-span-2">
                  <span className="font-bold">{stats.avgReward > 0 ? '+' : ''}{stats.avgReward.toFixed(2)}</span>
                  <span className="text-muted-foreground ml-1">Ø Reward</span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
