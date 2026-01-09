import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Flame, Minus, Plus, RefreshCw, Thermometer, Sun, Clock, Zap, Bot } from 'lucide-react';
import { Room } from '@/types/room';
import { cn } from '@/lib/utils';

interface HeatingStats {
  todayCycles: number;
  todayDurationMin: number;
  todayEnergyWh: number;
}

interface ThermostatCardProps {
  room: Room;
  onSetTemperature: (roomId: string, deviceId: string, temp: number) => Promise<boolean>;
  onTogglePvAuto: (roomId: string, enabled: boolean) => void;
  onToggleAutomation?: (roomId: string, enabled: boolean) => void;
  onRefresh: (roomId: string) => void;
  isLoading?: boolean;
  heatingStats?: HeatingStats;
}

export function ThermostatCard({
  room,
  onSetTemperature,
  onTogglePvAuto,
  onToggleAutomation,
  onRefresh,
  isLoading = false,
  heatingStats,
}: ThermostatCardProps) {
  const [localTemp, setLocalTemp] = useState(room.target_temp ?? room.comfort_temp);
  const [isSetting, setIsSetting] = useState(false);

  const handleTempChange = (value: number[]) => {
    setLocalTemp(value[0]);
  };

  const handleTempCommit = async () => {
    if (!room.tuya_device_id || !room.id) return;
    
    setIsSetting(true);
    await onSetTemperature(room.id, room.tuya_device_id, localTemp);
    setIsSetting(false);
  };

  const adjustTemp = async (delta: number) => {
    const newTemp = Math.min(30, Math.max(5, localTemp + delta));
    setLocalTemp(newTemp);
    
    if (!room.tuya_device_id || !room.id) return;
    
    setIsSetting(true);
    await onSetTemperature(room.id, room.tuya_device_id, newTemp);
    setIsSetting(false);
  };

  const setPresetTemp = async (temp: number) => {
    setLocalTemp(temp);
    
    if (!room.tuya_device_id || !room.id) return;
    
    setIsSetting(true);
    await onSetTemperature(room.id, room.tuya_device_id, temp);
    setIsSetting(false);
  };

  const hasDevice = !!room.tuya_device_id;
  const currentTemp = room.current_temp ?? '--';
  const isHeating = room.is_heating ?? false;

  return (
    <Card className={cn(
      'transition-all duration-300 border-2 border-transparent min-w-0 overflow-hidden min-h-[380px]',
      isHeating && 'border-orange-500/50 bg-orange-50/30 dark:bg-orange-950/20'
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-muted-foreground" />
            {room.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isHeating && (
              <Badge variant="destructive" className="gap-1">
                <Flame className="h-3 w-3" />
                Heizt
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => room.id && onRefresh(room.id)}
              disabled={isLoading || !hasDevice}
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!hasDevice ? (
          <div className="text-center py-4 text-muted-foreground">
            <p>Kein Thermostat zugeordnet</p>
            <p className="text-sm">Bearbeite den Raum um ein Gerät zuzuweisen</p>
          </div>
        ) : (
          <>
            {/* Temperature Display */}
            <div className="flex items-center justify-center gap-2 sm:gap-4">
              <div className="text-center min-w-0 flex-1">
                <p className="text-xl sm:text-3xl font-bold truncate">
                  {typeof currentTemp === 'number' ? `${currentTemp.toFixed(1)}°C` : currentTemp}
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground">Aktuell</p>
              </div>
              <div className="text-xl sm:text-2xl text-muted-foreground flex-shrink-0">→</div>
              <div className="text-center min-w-0 flex-1">
                <p className="text-xl sm:text-3xl font-bold text-primary truncate">{localTemp}°C</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Ziel</p>
              </div>
            </div>

            {/* Temperature Slider */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-10 sm:w-10 shrink-0"
                onClick={() => adjustTemp(-0.5)}
                disabled={isSetting || localTemp <= 5}
              >
                <Minus className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
              
              <Slider
                value={[localTemp]}
                min={5}
                max={30}
                step={0.5}
                onValueChange={handleTempChange}
                onValueCommit={handleTempCommit}
                disabled={isSetting}
                className="flex-1 min-w-0"
              />
              
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-10 sm:w-10 shrink-0"
                onClick={() => adjustTemp(0.5)}
                disabled={isSetting || localTemp >= 30}
              >
                <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </div>

            {/* Preset Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Button
                variant={localTemp === room.comfort_temp ? 'default' : 'outline'}
                size="sm"
                className="text-xs sm:text-sm"
                onClick={() => setPresetTemp(room.comfort_temp)}
                disabled={isSetting}
              >
                Komfort ({room.comfort_temp}°)
              </Button>
              <Button
                variant={localTemp === room.eco_temp ? 'default' : 'outline'}
                size="sm"
                className="text-xs sm:text-sm"
                onClick={() => setPresetTemp(room.eco_temp)}
                disabled={isSetting}
              >
                Eco ({room.eco_temp}°)
              </Button>
              <Button
                variant={localTemp === room.night_temp ? 'default' : 'outline'}
                size="sm"
                className="col-span-2 sm:col-span-1 text-xs sm:text-sm"
                onClick={() => setPresetTemp(room.night_temp)}
                disabled={isSetting}
              >
                Nacht ({room.night_temp}°)
              </Button>
            </div>

            {/* Automation Toggles */}
            <div className="flex flex-col gap-2 pt-2 border-t">
              {/* Automatik Toggle */}
              {onToggleAutomation && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">Auto-Empfehlung</span>
                  </div>
                  <Switch
                    checked={room.automation_enabled ?? false}
                    onCheckedChange={(checked) => room.id && onToggleAutomation(room.id, checked)}
                  />
                </div>
              )}
              
              {/* PV Auto Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm">PV-Automatik</span>
                </div>
                <Switch
                  checked={room.pv_auto_enabled ?? false}
                  onCheckedChange={(checked) => room.id && onTogglePvAuto(room.id, checked)}
                />
              </div>
            </div>

            {/* Heating Stats - immer anzeigen für stabile Höhe */}
            <div className="grid grid-cols-3 gap-1 pt-2 border-t text-xs text-muted-foreground text-center min-h-[40px]">
              {heatingStats && heatingStats.todayCycles > 0 ? (
                <>
                  <div className="flex flex-col items-center gap-0.5">
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span className="font-medium">{heatingStats.todayCycles}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Clock className="h-3 w-3 text-blue-500" />
                    <span className="font-medium">
                      {heatingStats.todayDurationMin < 60 
                        ? `${heatingStats.todayDurationMin}m` 
                        : `${Math.floor(heatingStats.todayDurationMin / 60)}h${heatingStats.todayDurationMin % 60}m`}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Zap className="h-3 w-3 text-yellow-500" />
                    <span className="font-medium">
                      {heatingStats.todayEnergyWh < 1000 
                        ? `${heatingStats.todayEnergyWh}Wh` 
                        : `${(heatingStats.todayEnergyWh / 1000).toFixed(1)}kWh`}
                    </span>
                  </div>
                </>
              ) : (
                <div className="col-span-3 flex items-center justify-center text-muted-foreground/50">
                  Keine Zyklen heute
                </div>
              )}
            </div>

            {/* Last Sync */}
            {room.last_thermostat_sync && (
              <p className="text-xs text-muted-foreground text-center">
                Zuletzt aktualisiert: {new Date(room.last_thermostat_sync).toLocaleTimeString('de-DE')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
