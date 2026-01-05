import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Flame, Minus, Plus, RefreshCw, Thermometer, Sun } from 'lucide-react';
import { Room } from '@/types/room';
import { cn } from '@/lib/utils';

interface ThermostatCardProps {
  room: Room;
  onSetTemperature: (roomId: string, deviceId: string, temp: number) => Promise<boolean>;
  onTogglePvAuto: (roomId: string, enabled: boolean) => void;
  onRefresh: (roomId: string) => void;
  isLoading?: boolean;
}

export function ThermostatCard({
  room,
  onSetTemperature,
  onTogglePvAuto,
  onRefresh,
  isLoading = false,
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
      'transition-all duration-300',
      isHeating && 'ring-2 ring-orange-500/50 bg-orange-50/30 dark:bg-orange-950/20'
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
            <div className="flex items-center justify-center gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Aktuell</p>
                <p className="text-3xl font-bold">
                  {typeof currentTemp === 'number' ? `${currentTemp.toFixed(1)}°C` : currentTemp}
                </p>
              </div>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Ziel</p>
                <p className="text-3xl font-bold text-primary">{localTemp}°C</p>
              </div>
            </div>

            {/* Temperature Slider */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => adjustTemp(-0.5)}
                disabled={isSetting || localTemp <= 5}
              >
                <Minus className="h-4 w-4" />
              </Button>
              
              <Slider
                value={[localTemp]}
                min={5}
                max={30}
                step={0.5}
                onValueChange={handleTempChange}
                onValueCommit={handleTempCommit}
                disabled={isSetting}
                className="flex-1"
              />
              
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => adjustTemp(0.5)}
                disabled={isSetting || localTemp >= 30}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Preset Buttons */}
            <div className="flex gap-2">
              <Button
                variant={localTemp === room.comfort_temp ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setPresetTemp(room.comfort_temp)}
                disabled={isSetting}
              >
                Komfort ({room.comfort_temp}°)
              </Button>
              <Button
                variant={localTemp === room.eco_temp ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setPresetTemp(room.eco_temp)}
                disabled={isSetting}
              >
                Eco ({room.eco_temp}°)
              </Button>
              <Button
                variant={localTemp === room.night_temp ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setPresetTemp(room.night_temp)}
                disabled={isSetting}
              >
                Nacht ({room.night_temp}°)
              </Button>
            </div>

            {/* PV Auto Toggle */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-yellow-500" />
                <span className="text-sm">PV-Automatik</span>
              </div>
              <Switch
                checked={room.pv_auto_enabled ?? false}
                onCheckedChange={(checked) => room.id && onTogglePvAuto(room.id, checked)}
              />
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
