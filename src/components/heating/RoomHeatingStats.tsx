import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flame, Clock, Zap, TrendingUp } from 'lucide-react';
import { Room } from '@/types/room';

interface RoomHeatingStatsProps {
  room: Room;
  stats: {
    todayCycles: number;
    todayDurationMin: number;
    todayEnergyWh: number;
    lastCycleDurationMin?: number;
  };
}

export function RoomHeatingStats({ room, stats }: RoomHeatingStatsProps) {
  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} Min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatEnergy = (wh: number) => {
    if (wh < 1000) return `${wh} Wh`;
    return `${(wh / 1000).toFixed(2)} kWh`;
  };

  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Heizstatistik: {room.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-orange-500">
              <Flame className="h-4 w-4" />
              <span className="text-lg font-bold">{stats.todayCycles}</span>
            </div>
            <p className="text-xs text-muted-foreground">Zyklen heute</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-blue-500">
              <Clock className="h-4 w-4" />
              <span className="text-lg font-bold">{formatDuration(stats.todayDurationMin)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Heizdauer</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-yellow-500">
              <Zap className="h-4 w-4" />
              <span className="text-lg font-bold">{formatEnergy(stats.todayEnergyWh)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Verbrauch</p>
          </div>
        </div>

        {room.heating_power_w && stats.todayCycles > 0 && (
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">
            Ø {Math.round(stats.todayDurationMin / stats.todayCycles)} Min/Zyklus • 
            {room.heating_power_w}W Heizleistung
          </div>
        )}

        {stats.todayCycles === 0 && (
          <div className="text-center text-sm text-muted-foreground py-2">
            Heute noch keine Heizzyklen
          </div>
        )}
      </CardContent>
    </Card>
  );
}
