import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Flame, Hand, Minus, Plus, RefreshCw, Thermometer, Sun, Clock, Zap, Bot, Leaf, Moon, X, WifiOff } from 'lucide-react';
import { Room } from '@/types/room';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getViennaMinutesSinceMidnight } from '@/lib/dateUtils';
import { AIBadge } from '@/components/ui/AIBadge';


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
  onCancelOverride?: (roomId: string) => void;
  onRefresh: (roomId: string) => void;
  isLoading?: boolean;
  heatingStats?: HeatingStats;
  nightStartTime?: string;
  nightEndTime?: string;
  hasApiError?: boolean;
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
  onCancelOverride,
  onRefresh,
  isLoading = false,
  heatingStats,
  nightStartTime = '22:00',
  nightEndTime = '06:00',
  hasApiError = false,
}: ThermostatCardProps) {
  const [localTemp, setLocalTemp] = useState(room.target_temp ?? room.comfort_temp);
  const [isSetting, setIsSetting] = useState(false);
  const [overrideRemaining, setOverrideRemaining] = useState<string | null>(null);

  // Synchronize localTemp when room.target_temp changes from database/automation
  useEffect(() => {
    if (room.target_temp !== undefined && room.target_temp !== null && !isSetting) {
      setLocalTemp(room.target_temp);
    }
  }, [room.target_temp, isSetting]);

  // Calculate override remaining time
  const overrideUntil = useMemo(() => {
    if (!room.manual_override_until) return null;
    const until = new Date(room.manual_override_until);
    if (until <= new Date()) return null;
    return until;
  }, [room.manual_override_until]);

  // Update countdown every minute
  useEffect(() => {
    if (!overrideUntil) {
      setOverrideRemaining(null);
      return;
    }

    const updateRemaining = () => {
      const now = new Date();
      const diff = overrideUntil.getTime() - now.getTime();
      if (diff <= 0) {
        setOverrideRemaining(null);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      if (hours > 0) {
        setOverrideRemaining(`${hours}h ${mins}m`);
      } else {
        setOverrideRemaining(`${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [overrideUntil]);

  const handleCancelOverride = () => {
    if (room.id && onCancelOverride) {
      onCancelOverride(room.id);
      toast.success('Automatik wieder aktiv');
    }
  };

  // Determine active automatic mode (what automation would choose)
  const activeMode = useMemo((): ActiveMode => {
    // Explizit Wiener Zeit verwenden
    const currentMinutes = getViennaMinutesSinceMidnight();
    const nightStart = parseTimeToMinutes(nightStartTime.substring(0, 5));
    const nightEnd = parseTimeToMinutes(nightEndTime.substring(0, 5));
    
    // Check if current time is in night period (handles overnight)
    const isNight = nightStart > nightEnd 
      ? (currentMinutes >= nightStart || currentMinutes < nightEnd)  // e.g., 22:00-06:00
      : (currentMinutes >= nightStart && currentMinutes < nightEnd);
    
    if (isNight) return 'night';
    if (room.pv_auto_active) return 'comfort';
    return 'eco';
  }, [nightStartTime, nightEndTime, room.pv_auto_active]);

  // Determine which mode button to highlight based on actual target temperature
  const displayMode = useMemo((): ActiveMode | null => {
    const targetTemp = room.target_temp;
    if (targetTemp === undefined || targetTemp === null) return null;
    
    // Check which preset the target temperature matches
    if (targetTemp === room.comfort_temp) return 'comfort';
    if (targetTemp === room.eco_temp) return 'eco';
    if (targetTemp === room.night_temp) return 'night';
    
    // If temp doesn't match any preset (e.g., manually set to 19°C)
    return null;
  }, [room.target_temp, room.comfort_temp, room.eco_temp, room.night_temp]);

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
          <CardTitle className="text-lg flex items-center gap-2 min-w-0">
            <Thermometer className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="truncate">{room.name}</span>
            <AIBadge active={!!room.automation_enabled} className="shrink-0" />
          </CardTitle>
          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            {hasApiError ? (
              <Badge variant="outline" className="gap-1 border-destructive text-destructive bg-destructive/10">
                <WifiOff className="h-3 w-3" />
                Offline
              </Badge>
            ) : isHeating ? (
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
              className="h-11 w-11"
              onClick={() => room.id && onRefresh(room.id)}
              disabled={isLoading || !hasDevice}
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        {/* Manual Override Banner */}
        {hasManualOverride && overrideUntil && (
          <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-2 flex items-center justify-between gap-2 -mt-1">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm min-w-0">
              <Hand className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">
                Manuell bis {overrideUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}
              </span>
              {overrideRemaining && (
                <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">
                  ({overrideRemaining})
                </span>
              )}
            </div>
            {onCancelOverride && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleCancelOverride}
                className="h-6 w-6 p-0 hover:bg-amber-200 dark:hover:bg-amber-800 flex-shrink-0"
                title="Override beenden"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
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
                {/* Solar-Limit Anzeige wenn aktiv */}
                {room.pv_auto_active && room.solar_limit_temp && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 cursor-help">
                        ☀️ max {room.solar_limit_temp}°C
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[200px] text-center">
                      <p>Der Raum darf sich durch Sonneneinstrahlung bis zu dieser Temperatur erwärmen - ohne aktives Heizen</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Estrich-Speicher-Sättigung: Raum hat heute Komfort erreicht, läuft jetzt auf Eco-Setpoint */}
                {(room as any).comfort_saturated_at && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5 cursor-help">
                        🧱 Estrich-Speicher
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px] text-center">
                      <p>Komforttemperatur heute erreicht. Setpoint zurück auf Eco — der aufgeheizte Estrich gibt die Wärme weiter ab, kein zusätzlicher Stromverbrauch.</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Temperature Slider */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
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
                className="flex-1 min-w-0"
              />

              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => adjustTemp(0.5)}
                disabled={isSetting || localTemp >= 30}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Konstanttemperatur-Hinweis: wenn Eco == Komfort */}
            {room.eco_temp === room.comfort_temp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md py-1.5 px-2 cursor-help">
                    <Thermometer className="h-3 w-3" />
                    <span>Konstanttemperatur ({room.eco_temp}°C) — kein Stufenwechsel</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-center">
                  <p>Eco- und Komforttemperatur sind identisch konfiguriert. Der Raum wird konstant auf dieser Temperatur gehalten — die PV-Automatik wechselt hier nicht zwischen Stufen.</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Preset Buttons with Active Mode Highlighting */}
            <div className="grid grid-cols-3 gap-2">
              {/* Komfort Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={displayMode === 'comfort' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    displayMode === 'comfort' && 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                  )}
                  onClick={() => setPresetTemp(room.comfort_temp)}
                  disabled={isSetting}
                >
                  <Sun className="h-3 w-3" />
                  {room.comfort_temp}°
                </Button>
                {displayMode === 'comfort' && (
                  hasManualOverride ? (
                    <span className="text-[10px] font-medium flex items-center gap-0.5 text-amber-600">
                      <Hand className="h-2.5 w-2.5" />
                      Manuell
                    </span>
                  ) : activeMode === 'comfort' && (room.pv_auto_enabled || room.automation_enabled) && (
                    <span className={cn(
                      "text-[10px] font-medium flex items-center gap-0.5",
                      room.pv_auto_enabled ? "text-amber-600" : "text-blue-600"
                    )}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {room.pv_auto_enabled && room.pv_auto_active ? 'Solar-Limit' : room.pv_auto_enabled ? 'PV' : 'KI'}
                    </span>
                  )
                )}
              </div>

              {/* Eco Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={displayMode === 'eco' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    displayMode === 'eco' && 'bg-green-500 hover:bg-green-600 text-white border-green-500'
                  )}
                  onClick={() => setPresetTemp(room.eco_temp)}
                  disabled={isSetting}
                >
                  <Leaf className="h-3 w-3" />
                  {room.eco_temp}°
                </Button>
                {displayMode === 'eco' && (
                  hasManualOverride ? (
                    <span className="text-[10px] font-medium flex items-center gap-0.5 text-amber-600">
                      <Hand className="h-2.5 w-2.5" />
                      Manuell
                    </span>
                  ) : activeMode === 'eco' && (room.pv_auto_enabled || room.automation_enabled) && (
                    <span className={cn(
                      "text-[10px] font-medium flex items-center gap-0.5",
                      room.pv_auto_enabled ? "text-green-600" : "text-blue-600"
                    )}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {room.pv_auto_enabled ? 'PV' : 'KI'}
                    </span>
                  )
                )}
              </div>

              {/* Nacht Button */}
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant={displayMode === 'night' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "w-full text-xs gap-1 h-9",
                    displayMode === 'night' && 'bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-500'
                  )}
                  onClick={() => setPresetTemp(room.night_temp)}
                  disabled={isSetting}
                >
                  <Moon className="h-3 w-3" />
                  {room.night_temp}°
                </Button>
                {displayMode === 'night' && (
                  hasManualOverride ? (
                    <span className="text-[10px] font-medium flex items-center gap-0.5 text-amber-600">
                      <Hand className="h-2.5 w-2.5" />
                      Manuell
                    </span>
                  ) : activeMode === 'night' && (
                    <span className="text-[10px] font-medium flex items-center gap-0.5 text-indigo-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      Zeit
                    </span>
                  )
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

            {/* Last Sync - immer anzeigen für stabile Höhe; Offline-Badge wenn > 2h */}
            {(() => {
              const sync = room.last_thermostat_sync;
              const ageMs = sync ? Date.now() - new Date(sync).getTime() : Infinity;
              const isStale = ageMs > 2 * 60 * 60 * 1000;
              if (isStale && sync) {
                const ageH = Math.floor(ageMs / 3600000);
                return (
                  <div className="flex items-center justify-center gap-1 h-4">
                    <WifiOff className="w-3 h-3 text-warning" />
                    <span className="text-[11px] text-warning font-medium">
                      Thermostat offline – letzter Sync vor {ageH}h
                    </span>
                  </div>
                );
              }
              return (
                <p className="text-xs text-muted-foreground text-center h-4">
                  {sync ? `Zuletzt: ${new Date(sync).toLocaleTimeString('de-DE')}` : '\u00A0'}
                </p>
              );
            })()}
          </>
        )}
      </CardContent>
    </Card>
  );
}
