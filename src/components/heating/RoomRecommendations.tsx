import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Thermometer, Sun, Battery, Snowflake, Flame, Zap } from 'lucide-react';
import { Room, RoomRecommendation, PRIORITY_ICONS } from '@/types/room';
import { cn } from '@/lib/utils';

interface RoomRecommendationsProps {
  rooms: Room[];
  getCurrentRecommendation: (roomId: string) => RoomRecommendation | undefined;
  strategy?: string;
}

export function RoomRecommendations({ 
  rooms, 
  getCurrentRecommendation,
  strategy 
}: RoomRecommendationsProps) {
  const getPriorityIcon = (priority?: string) => {
    switch (priority) {
      case 'heat_now':
        return <Flame className="h-4 w-4 text-orange-500" />;
      case 'preheat':
        return <Sun className="h-4 w-4 text-amber-500" />;
      case 'hold':
        return <Zap className="h-4 w-4 text-blue-500" />;
      case 'reduce':
        return <Battery className="h-4 w-4 text-green-500" />;
      case 'off':
        return <Snowflake className="h-4 w-4 text-cyan-500" />;
      default:
        return <Thermometer className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'heat_now':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'preheat':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'hold':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'reduce':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'off':
        return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const roomsWithRecs = rooms.map(room => ({
    ...room,
    recommendation: room.id ? getCurrentRecommendation(room.id) : undefined
  }));

  const hasAnyRecommendations = roomsWithRecs.some(r => r.recommendation);

  if (rooms.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="h-5 w-5" />
          Aktuelle Thermostat-Empfehlungen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnyRecommendations ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Keine aktuellen Empfehlungen. Führe eine Analyse durch, um raumspezifische Empfehlungen zu erhalten.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {roomsWithRecs.map(room => {
                const rec = room.recommendation;
                return (
                  <div
                    key={room.id}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border',
                      rec ? getPriorityColor(rec.priority) : 'bg-muted/50 border-border'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {getPriorityIcon(rec?.priority)}
                      <div>
                        <p className="font-medium">{room.name}</p>
                        {rec?.reason && (
                          <p className="text-xs opacity-80 max-w-[200px] truncate">
                            {rec.reason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {rec ? (
                        <>
                          <span className="text-2xl font-bold">
                            {rec.recommended_temp}°C
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {rec.start_time} - {rec.end_time}
                          </Badge>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          Keine Empfehlung
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {strategy && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  <strong>Strategie:</strong> {strategy}
                </p>
              </div>
            )}

            <div className="pt-2 border-t">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="flex items-center gap-1">
                  <Flame className="h-3 w-3 text-orange-500" /> Jetzt heizen
                </span>
                <span className="flex items-center gap-1">
                  <Sun className="h-3 w-3 text-amber-500" /> Vorheizen
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-blue-500" /> Halten
                </span>
                <span className="flex items-center gap-1">
                  <Battery className="h-3 w-3 text-green-500" /> Reduzieren
                </span>
                <span className="flex items-center gap-1">
                  <Snowflake className="h-3 w-3 text-cyan-500" /> Aus
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
