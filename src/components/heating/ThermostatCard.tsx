import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Flame, Hand, Minus, Plus, RefreshCw, Thermometer, Sun, Clock, Zap, Bot, Leaf, Moon } from 'lucide-react';
import { Room } from '@/types/room';
import { cn } from '@/lib/utils';

interface HeatingStats {
  todayCycles: number;
  todayDurationMin: number;
  todayEnergyWh: number;
}

type ActiveMode = 'comfort' | 'eco' | 'night';

interface ThermostatCardProps {
  room: Room;
  onSetTemperature: (roomId: string, deviceId: string, temp: number) => Promise<boolean>;
  onTogglePvAuto: (roomId: string, enabled: boolean) => void;
  onToggleAutomation?: (roomId: string, enabled: boolean) => void;
  onRefresh: (roomId: string) => void;
  isLoading?: boolean;
  heatingStats?: HeatingStats;
  nightStartTime?: string;
  nightEndTime?: string;
}

// Helper to parse time string "HH:MM" to minutes since midnight
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

export function ThermostatCard({
  room,
  onSetTemperature,
  onTogglePvAuto,
  onToggleAutomation,
  onRefresh,
  isLoading = false,
  heatingStats,
  nightStartTime = '22:00',
  nightEndTime = '06:00',
}: ThermostatCardProps) {
  const [localTemp, setLocalTemp] = useState(room.target_temp ?? room.comfort_temp);
  const [isSetting, setIsSetting] = useState(false);

  // Determine active automatic mode
  const activeMode = useMemo((): ActiveMode => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const nightStart = parseTimeToMinutes(nightStartTime);
    const nightEnd = parseTimeToMinutes(nightEndTime);
    
    // Check if current time is in night period (handles overnight)
    const isNight = nightStart > nightEnd 
      ? (currentMinutes >= nightStart || currentMinutes < nightEnd)  // e.g., 22:00-06:00
      : (currentMinutes >= nightStart && currentMinutes < nightEnd);
    
    if (isNight) return 'night';
    if (room.pv_auto_active) return 'comfort';
    return 'eco';
  }, [nightStartTime, nightEndTime, room.pv_auto_active]);

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
  const hasManualOverride = room.manual_override_until && new Date(room.manual_override_until) > new Date();

  return (
    <Card className={cn(
      'transition-colors duration-300 border-2 border-transparent min-w-0 overflow-hidden min-h-[380px] h-full',
      isHeating && 'border-orange-500/50 bg-orange-50/30 dark:bg-orange-950/20'
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-muted-foreground" />
            {room.name}
          </CardTitle>
          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            {isHeating ? (
              <Badge variant="destructive" className="gap-1">
                <Flame className="h-3 w-3" />
                Heizt
              </Badge>
            ) : (
              <div className="h-5 w-[52px]" />
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
        {/* Manual Override Badge */}
        {hasManualOverride && (
          <div className="flex justify-center -mt-1">
            <Badge variant="secondary" className="gap-1 text-xs">
              <Hand className="h-3 w-3" />
              Manuell bis {new Date(room.manual_override_until!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          </div>
        )}
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

            {/* Preset Buttons with Active Mode Highlighting */}
            <div className="grid grid-cols-3 gap-2">
              {/* Komfort Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={activeMode === 'comfort' && (room.pv_auto_enabled || room.automation_enabled) ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    activeMode === 'comfort' && room.pv_auto_enabled && !hasManualOverride && 
                      'bg-amber-500 hover:bg-amber-600 text-white border-amber-500',
                    activeMode === 'comfort' && room.automation_enabled && !room.pv_auto_enabled && !hasManualOverride &&
                      'bg-blue-500 hover:bg-blue-600 text-white border-blue-500'
                  )}
                  onClick={() => setPresetTemp(room.comfort_temp)}
                  disabled={isSetting}
                >
                  <Sun className="h-3 w-3" />
                  {room.comfort_temp}°
                </Button>
                {activeMode === 'comfort' && (room.pv_auto_enabled || room.automation_enabled) && !hasManualOverride && (
                  <span className={cn(
                    "text-[10px] font-medium flex items-center gap-0.5",
                    room.pv_auto_enabled ? "text-amber-600" : "text-blue-600"
                  )}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    {room.pv_auto_enabled ? 'PV' : 'KI'}
                  </span>
                )}
              </div>

              {/* Eco Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={activeMode === 'eco' && (room.pv_auto_enabled || room.automation_enabled) ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    activeMode === 'eco' && room.pv_auto_enabled && !hasManualOverride && 
                      'bg-green-500 hover:bg-green-600 text-white border-green-500',
                    activeMode === 'eco' && room.automation_enabled && !room.pv_auto_enabled && !hasManualOverride &&
                      'bg-blue-500 hover:bg-blue-600 text-white border-blue-500'
                  )}
                  onClick={() => setPresetTemp(room.eco_temp)}
                  disabled={isSetting}
                >
                  <Leaf className="h-3 w-3" />
                  {room.eco_temp}°
                </Button>
                {activeMode === 'eco' && (room.pv_auto_enabled || room.automation_enabled) && !hasManualOverride && (
                  <span className={cn(
                    "text-[10px] font-medium flex items-center gap-0.5",
                    room.pv_auto_enabled ? "text-green-600" : "text-blue-600"
                  )}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    {room.pv_auto_enabled ? 'PV' : 'KI'}
                  </span>
                )}
              </div>

              {/* Nacht Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={activeMode === 'night' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    activeMode === 'night' && !hasManualOverride && 
                      'bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-500'
                  )}
                  onClick={() => setPresetTemp(room.night_temp)}
                  disabled={isSetting}
                >
                  <Moon className="h-3 w-3" />
                  {room.night_temp}°
                </Button>
                {activeMode === 'night' && !hasManualOverride && (
                  <span className="text-[10px] font-medium flex items-center gap-0.5 text-indigo-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    Zeit
                  </span>
                )}
              </div>
            </div>

            {/* Automation Toggles with Activity Indicators */}
            <div className="flex flex-col gap-2 pt-2 border-t">
              {/* Automatik Toggle */}
              {onToggleAutomation && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">Auto-Empfehlung</span>
                    {room.automation_enabled && !hasManualOverride && (
                      <Badge variant="outline" className="text-[10px] h-5 gap-0.5 border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        Aktiv
                      </Badge>
                    )}
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
                  {room.pv_auto_enabled && !hasManualOverride && (
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-[10px] h-5 gap-0.5",
                        room.pv_auto_active 
                          ? "border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950" 
                          : "border-green-400 text-green-600 bg-green-50 dark:bg-green-950"
                      )}
                    >
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full animate-pulse",
                        room.pv_auto_active ? "bg-amber-500" : "bg-green-500"
                      )} />
                      {room.pv_auto_active ? 'Komfort' : 'Eco'}
                    </Badge>
                  )}
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

            {/* Last Sync - immer anzeigen für stabile Höhe */}
            <p className="text-xs text-muted-foreground text-center h-4">
              {room.last_thermostat_sync 
                ? `Zuletzt: ${new Date(room.last_thermostat_sync).toLocaleTimeString('de-DE')}`
                : '\u00A0'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
