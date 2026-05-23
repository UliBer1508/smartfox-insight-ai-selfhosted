import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Flame, Home } from 'lucide-react';
import { Room } from '@/types/room';
import { useHeatingConsumption, Period } from '@/hooks/useHeatingConsumption';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { AIBadge } from '@/components/ui/AIBadge';


interface HeatingOverviewCardProps {
  rooms: Room[];
}

const PERIOD_LABELS: Record<Period, string> = {
  day: 'Tag',
  month: 'Monat',
  year: 'Jahr',
};

export function HeatingOverviewCard({ rooms }: HeatingOverviewCardProps) {
  const [period, setPeriod] = useState<Period>('day');
  const { consumption, isLoading } = useHeatingConsumption(rooms);
  const { settings } = useHeatingSettings();
  const aiAuto = Boolean((settings as { ai_auto_mode_enabled?: boolean })?.ai_auto_mode_enabled);


  const data = consumption[period];

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} Min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const formatEnergy = (wh: number) => {
    if (wh < 1000) return `${wh} Wh`;
    return `${(wh / 1000).toFixed(2)} kWh`;
  };

  const activeRooms = rooms.filter(r => r.is_heating);

  return (
    <Card className="overflow-hidden w-full max-w-full">
      <CardHeader className="pb-1 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500" />
            <span>Heizverbrauch</span>
            <AIBadge active={aiAuto} className="ml-1" />
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-[75px] h-6 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Tag</SelectItem>
              <SelectItem value="month">Monat</SelectItem>
              <SelectItem value="year">Jahr</SelectItem>
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 sm:space-y-3 pt-0">
        {isLoading ? (
          <div className="text-center text-xs sm:text-sm text-muted-foreground py-4">
            Lade Daten...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1 sm:gap-2 text-center">
              <div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-orange-500">{data.cycles}</div>
                <p className="text-[10px] sm:text-xs text-muted-foreground">Zyklen</p>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-blue-500">{formatDuration(data.durationMin)}</div>
                <p className="text-[10px] sm:text-xs text-muted-foreground">Dauer</p>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-yellow-500">{formatEnergy(data.energyWh)}</div>
                <p className="text-[10px] sm:text-xs text-muted-foreground">Energie</p>
              </div>
            </div>

            {activeRooms.length > 0 && (
              <div className="pt-1.5 sm:pt-2 border-t">
                <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                  <Home className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                  <span className="hidden sm:inline">Heizen jetzt:</span>
                  <span className="truncate">{activeRooms.map(r => r.name).join(', ')}</span>
                </p>
              </div>
            )}

            {data.topConsumers.length > 0 && (
              <div className="pt-1.5 sm:pt-2 border-t">
                <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5 sm:mb-1">Top Verbraucher:</p>
                <div className="space-y-0.5 sm:space-y-1">
                  {data.topConsumers.map(({ roomId, roomName, energyWh }) => (
                    <div key={roomId} className="flex justify-between text-[10px] sm:text-xs">
                      <span className="truncate mr-2">{roomName}</span>
                      <span className="font-mono shrink-0">{formatEnergy(energyWh)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.cycles === 0 && data.energyWh === 0 && (
              <div className="text-center text-xs sm:text-sm text-muted-foreground py-1.5 sm:py-2">
                Keine Heizaktivität im {PERIOD_LABELS[period]}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
