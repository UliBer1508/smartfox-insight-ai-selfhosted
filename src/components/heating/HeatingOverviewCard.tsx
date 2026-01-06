import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame, Clock, Zap, Home } from 'lucide-react';
import { Room } from '@/types/room';

interface HeatingOverviewCardProps {
  rooms: Room[];
  stats: Record<string, {
    todayCycles: number;
    todayDurationMin: number;
    todayEnergyWh: number;
  }>;
}

export function HeatingOverviewCard({ rooms, stats }: HeatingOverviewCardProps) {
  // Calculate totals
  const totals = Object.values(stats).reduce(
    (acc, s) => ({
      cycles: acc.cycles + s.todayCycles,
      duration: acc.duration + s.todayDurationMin,
      energy: acc.energy + s.todayEnergyWh,
    }),
    { cycles: 0, duration: 0, energy: 0 }
  );

  // Find top consumer
  const roomsWithStats = rooms
    .map(room => ({
      room,
      energy: stats[room.id || '']?.todayEnergyWh || 0,
    }))
    .filter(r => r.energy > 0)
    .sort((a, b) => b.energy - a.energy);

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          Heizverbrauch heute
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xl font-bold text-orange-500">{totals.cycles}</div>
            <p className="text-xs text-muted-foreground">Zyklen</p>
          </div>
          <div>
            <div className="text-xl font-bold text-blue-500">{formatDuration(totals.duration)}</div>
            <p className="text-xs text-muted-foreground">Heizdauer</p>
          </div>
          <div>
            <div className="text-xl font-bold text-yellow-500">{formatEnergy(totals.energy)}</div>
            <p className="text-xs text-muted-foreground">Verbrauch</p>
          </div>
        </div>

        {activeRooms.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Home className="h-3 w-3" />
              Heizen jetzt: {activeRooms.map(r => r.name).join(', ')}
            </p>
          </div>
        )}

        {roomsWithStats.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">Top Verbraucher:</p>
            <div className="space-y-1">
              {roomsWithStats.slice(0, 3).map(({ room, energy }) => (
                <div key={room.id} className="flex justify-between text-xs">
                  <span>{room.name}</span>
                  <span className="font-mono">{formatEnergy(energy)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {totals.cycles === 0 && (
          <div className="text-center text-sm text-muted-foreground py-2">
            Heute noch keine Heizaktivität
          </div>
        )}
      </CardContent>
    </Card>
  );
}
