import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Room } from '@/types/room';
import { HeatingSettings } from '@/types/heating';
import { Sun, Moon, Battery, Thermometer, Zap, Check, X, Bot } from 'lucide-react';

interface DailyHeatingScheduleProps {
  rooms: Room[];
  settings: HeatingSettings;
  currentSurplus: number | null;
  batterySoc: number | null;
}

type HeatingMode = 'night' | 'eco' | 'comfort' | 'battery_protect';

function isNightTime(nightStart: string, nightEnd: string): boolean {
  // Explizit Wiener Zeit verwenden (unabhängig von Browser-Zeitzone)
  const viennaTime = new Date().toLocaleString('en-US', { 
    timeZone: 'Europe/Vienna',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false 
  });
  const [hours, minutes] = viennaTime.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;
  
  const [startH, startM] = nightStart.split(':').map(Number);
  const [endH, endM] = nightEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  if (startMinutes > endMinutes) {
    // Over midnight (e.g., 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function getCurrentMode(
  nightStart: string, 
  nightEnd: string, 
  surplus: number | null, 
  batterySoc: number | null,
  minBatterySoc: number,
  thresholdOn: number
): HeatingMode {
  if (isNightTime(nightStart, nightEnd)) return 'night';
  if (batterySoc !== null && batterySoc < minBatterySoc) return 'battery_protect';
  if (surplus !== null && surplus >= thresholdOn) return 'comfort';
  return 'eco';
}

const MODE_CONFIG: Record<HeatingMode, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  night: { 
    label: 'Nacht', 
    icon: <Moon className="h-4 w-4" />, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10'
  },
  eco: { 
    label: 'Eco', 
    icon: <Zap className="h-4 w-4" />, 
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10'
  },
  comfort: { 
    label: 'Komfort', 
    icon: <Sun className="h-4 w-4" />, 
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10'
  },
  battery_protect: { 
    label: 'Batterie-Schutz', 
    icon: <Battery className="h-4 w-4" />, 
    color: 'text-red-500',
    bgColor: 'bg-red-500/10'
  }
};

export function DailyHeatingSchedule({ rooms, settings, currentSurplus, batterySoc }: DailyHeatingScheduleProps) {
  // Zeit-Strings normalisieren (DB liefert HH:MM:SS, wir brauchen HH:MM)
  const nightStart = (settings.night_start_time || '22:00').substring(0, 5);
  const nightEnd = (settings.night_end_time || '06:00').substring(0, 5);
  const thresholdOn = settings.pv_surplus_threshold_on || 500;
  const thresholdOff = settings.pv_surplus_threshold_off || 200;
  const minBatterySoc = settings.min_battery_soc || 20;

  const currentMode = useMemo(() => 
    getCurrentMode(nightStart, nightEnd, currentSurplus, batterySoc, minBatterySoc, thresholdOn),
    [nightStart, nightEnd, currentSurplus, batterySoc, minBatterySoc, thresholdOn]
  );

  const sortedRooms = useMemo(() => 
    [...rooms].sort((a, b) => (a.priority || 99) - (b.priority || 99)),
    [rooms]
  );

  const modeConfig = MODE_CONFIG[currentMode];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-primary" />
            Heizungs-Tagesprogramm
          </CardTitle>
          <Badge variant="outline" className={`${modeConfig.color} ${modeConfig.bgColor} border-0`}>
            {modeConfig.icon}
            <span className="ml-1">{modeConfig.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode explanation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className={`rounded-lg p-2 ${currentMode === 'night' ? 'ring-2 ring-primary' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1 text-blue-400 font-medium">
              <Moon className="h-3 w-3" />
              Nacht
            </div>
            <div className="text-muted-foreground mt-0.5">{nightStart}-{nightEnd}</div>
          </div>
          <div className={`rounded-lg p-2 ${currentMode === 'eco' ? 'ring-2 ring-primary' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1 text-yellow-500 font-medium">
              <Zap className="h-3 w-3" />
              Eco
            </div>
            <div className="text-muted-foreground mt-0.5">Standard tagsüber</div>
          </div>
          <div className={`rounded-lg p-2 ${currentMode === 'comfort' ? 'ring-2 ring-primary' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1 text-orange-500 font-medium">
              <Sun className="h-3 w-3" />
              Komfort
            </div>
            <div className="text-muted-foreground mt-0.5">PV &gt;{thresholdOn}W</div>
          </div>
          <div className={`rounded-lg p-2 ${currentMode === 'battery_protect' ? 'ring-2 ring-primary' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-1 text-red-500 font-medium">
              <Battery className="h-3 w-3" />
              Schutz
            </div>
            <div className="text-muted-foreground mt-0.5">Batterie &lt;{minBatterySoc}%</div>
          </div>
        </div>

        {/* Room temperature table */}
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 font-medium">Raum</th>
                <th className="text-center py-2 font-medium w-16">
                  <Moon className="h-3 w-3 inline text-blue-400" />
                </th>
                <th className="text-center py-2 font-medium w-16">
                  <Zap className="h-3 w-3 inline text-yellow-500" />
                </th>
                <th className="text-center py-2 font-medium w-16">
                  <Sun className="h-3 w-3 inline text-orange-500" />
                </th>
                <th className="text-center py-2 font-medium w-12">Prio</th>
                <th className="text-center py-2 font-medium w-10" title="PV-Automatik">
                  <Sun className="h-3 w-3 inline text-amber-500" />
                </th>
                <th className="text-center py-2 font-medium w-10" title="KI-Empfehlung">
                  <Bot className="h-3 w-3 inline text-purple-500" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRooms.map((room) => {
                const nightTemp = room.night_temp || settings.night_temp || 17;
                const ecoTemp = room.eco_temp || settings.eco_temp || 19;
                const comfortTemp = room.comfort_temp || settings.comfort_temp || 21;
                
                // Determine which temp column to highlight based on current mode
                const activeTemp = currentMode === 'night' ? nightTemp 
                  : currentMode === 'comfort' ? comfortTemp 
                  : ecoTemp;
                
                return (
                  <tr key={room.id} className="border-b border-muted/50 last:border-0">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate max-w-[120px]">{room.name}</span>
                        {room.is_heating && (
                          <span className="text-orange-500 animate-pulse">🔥</span>
                        )}
                      </div>
                    </td>
                    <td className={`text-center py-2 font-mono ${currentMode === 'night' ? 'font-bold text-blue-400' : 'text-muted-foreground'}`}>
                      {nightTemp}°
                    </td>
                    <td className={`text-center py-2 font-mono ${currentMode === 'eco' || currentMode === 'battery_protect' ? 'font-bold text-yellow-500' : 'text-muted-foreground'}`}>
                      {ecoTemp}°
                    </td>
                    <td className={`text-center py-2 font-mono ${currentMode === 'comfort' ? 'font-bold text-orange-500' : 'text-muted-foreground'}`}>
                      {comfortTemp}°
                    </td>
                    <td className="text-center py-2">
                      <Badge variant="outline" className="text-xs px-1.5">
                        {room.priority || '-'}
                      </Badge>
                    </td>
                    <td className="text-center py-2">
                      {room.pv_auto_enabled ? (
                        <Check className="h-4 w-4 text-green-500 inline" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground inline" />
                      )}
                    </td>
                    <td className="text-center py-2">
                      {room.automation_enabled ? (
                        <Check className="h-4 w-4 text-purple-500 inline" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground inline" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-1">
            <Sun className="h-3 w-3 text-amber-500" />
            <span>PV = Zeit-/Überschuss-Automatik</span>
          </div>
          <div className="flex items-center gap-1">
            <Bot className="h-3 w-3 text-purple-500" />
            <span>KI = ML-Empfehlungen</span>
          </div>
        </div>

        {/* Current status info */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-2 border-t">
          <span>PV-Überschuss: <span className="font-mono text-foreground">{currentSurplus !== null ? `${currentSurplus}W` : '—'}</span></span>
          <span>Batterie: <span className="font-mono text-foreground">{batterySoc !== null ? `${batterySoc}%` : '—'}</span></span>
          <span>Schwelle An: <span className="font-mono">{thresholdOn}W</span></span>
          <span>Schwelle Aus: <span className="font-mono">{thresholdOff}W</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
