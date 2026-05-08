import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnergyReading } from '@/types/energy';
import { HeatingSettings } from '@/types/heating';
import { Room } from '@/types/room';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useHeatingAnalysis } from '@/hooks/useHeatingAnalysis';
import { usePvForecast } from '@/hooks/usePvForecast';
import { useRooms } from '@/hooks/useRooms';
import { useTuyaControl } from '@/hooks/useTuyaControl';
import { useRoomHeatingLogs } from '@/hooks/useRoomHeatingLogs';
import { useAutomation } from '@/hooks/useAutomation';
import { useApiErrors } from '@/hooks/useApiErrors';
import { useControlMode } from '@/hooks/useControlMode';
import { HeatingPeriodCard } from './HeatingPeriodCard';
import { BatteryStatus } from './BatteryStatus';
import { BatteryReserveStatus } from './BatteryReserveStatus';
import { PvForecastCard } from './PvForecastCard';
import { RoomRecommendations } from './RoomRecommendations';
import { ThermostatCard } from './ThermostatCard';
import { HeatingOverviewCard } from './HeatingOverviewCard';
import { HeatingHistoryChart } from './HeatingHistoryChart';
import { SolarGainChart } from './SolarGainChart';
import { EnergyCostWidget } from '@/components/energy/EnergyCostWidget';
import { AIStatusWidget } from './AIStatusWidget';
import { MLFollowRateWidget } from './MLFollowRateWidget';
import { ApiErrorBanner } from './ApiErrorBanner';
import { usePushAllTemps } from '@/hooks/usePushAllTemps';
import { Thermometer, Loader2, Zap, Sun, Battery, Home, RefreshCw, Clock, Brain, Bot, Send } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { LearningProgress } from './LearningProgress';
import { DailyHeatingSchedule } from './DailyHeatingSchedule';
import { AISettingsSuggestions } from './AISettingsSuggestions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getLocalDateString, getViennaHour } from '@/lib/dateUtils';
import { format } from 'date-fns';

interface HeatingDashboardProps {
  readings: EnergyReading[];
  currentReading: EnergyReading | null;
  energyIn: number;
  energyOut: number;
  pvEnergy: number;
  isLoadingPv?: boolean;
}

export function HeatingDashboard({ readings, currentReading, energyIn, energyOut, pvEnergy, isLoadingPv }: HeatingDashboardProps) {
  const { settings } = useHeatingSettings();
  const { mode: controlMode } = useControlMode();
  const isLocalMode = controlMode === 'local';
  const modeLabel = isLocalMode ? 'Lokaler Service (LAN)' : 'Cloud API';
  const pushTooltip = isLocalMode
    ? 'Sendet alle Zieltemperaturen über den lokalen Service (LAN)'
    : 'Sendet alle Zieltemperaturen via Tuya Cloud API';
  const syncTooltip = isLocalMode
    ? 'Liest aktuelle Temperaturen über den lokalen Service (LAN)'
    : 'Liest aktuelle Temperaturen via Tuya Cloud API';
  const { 
    isAnalyzing, 
    analysisResult, 
    recommendations,
    loadRecommendations,
    analyzeHeating,
    setAnalysisResult
  } = useHeatingAnalysis();
  const {
    forecasts,
    todayForecast,
    tomorrowForecast,
    isFetching,
    loadForecasts,
    fetchForecast,
  } = usePvForecast();
  const {
    rooms,
    isLoading: roomsLoading,
    saveRoom,
    saveRecommendations: saveRoomRecommendations,
    getCurrentRecommendation,
    loadRecommendations: loadRoomRecommendations,
    loadRooms,
    updateRoomLocally
  } = useRooms();

  const {
    isSyncing,
    setTemperature,
    syncAllStatus,
  } = useTuyaControl();

  const {
    stats: heatingStats,
    loadLogs: loadHeatingLogs,
    getRoomStats,
  } = useRoomHeatingLogs();

  const {
    toggleAutomation,
    applyRecommendations,
    isApplying,
  } = useAutomation();

  const {
    hasRoomError,
    refetch: refetchErrors,
  } = useApiErrors();

  const { pushAllTemps, isPushing } = usePushAllTemps();

  const [isAnalyzingRooms, setIsAnalyzingRooms] = useState(false);
  const [roomStrategy, setRoomStrategy] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  // syncIntervalRef entfernt — Auto-Sync deaktiviert (siehe unten)

  // Auto-Sync deaktiviert: Tuya-Cloud-Sync verbraucht 2 Calls/Sync und sprengte
  // die Tagesquote. Stattdessen liest das Dashboard `current_temp` und `is_heating`
  // direkt aus der DB (vom lokalen Collector aktuell gehalten).
  // Manueller Refresh-Button bleibt verfügbar; sync-all hat zusätzlich ein 60-Min-Gate.

  useEffect(() => {
    loadRecommendations();
    loadForecasts();
    loadHeatingLogs();
    // Räume aus DB neu laden (kein Tuya-Call)
    loadRooms();
  }, [loadRecommendations, loadForecasts, loadHeatingLogs, loadRooms]);

  // DB-Polling alle 60s für aktuelle Raumdaten — verursacht KEINE Tuya-Calls
  useEffect(() => {
    const dbPoll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadRooms();
      loadHeatingLogs();
    }, 60_000);
    return () => clearInterval(dbPoll);
  }, [loadRooms, loadHeatingLogs]);

  const handleSyncThermostats = useCallback(async () => {
    await syncAllStatus();
    await loadRooms();
    await loadHeatingLogs();
    setLastSyncTime(new Date());
  }, [syncAllStatus, loadRooms, loadHeatingLogs]);

  const handleSetTemperature = useCallback(async (roomId: string, deviceId: string, temp: number): Promise<boolean> => {
    // Optimistisches Update VOR dem API-Call
    updateRoomLocally(roomId, { target_temp: temp });
    
    const success = await setTemperature(deviceId, temp, roomId);
    if (!success) {
      // Bei Fehler: Zustand durch Neuladen korrigieren
      await loadRooms();
    }
    return success;
  }, [setTemperature, updateRoomLocally, loadRooms]);

  const handleTogglePvAuto = useCallback(async (roomId: string, enabled: boolean) => {
    // skipReload=true für optimistisches Update ohne Karten-Verschiebung
    await saveRoom({ id: roomId, pv_auto_enabled: enabled }, true);
  }, [saveRoom]);

  const handleToggleAutomation = useCallback(async (roomId: string, enabled: boolean) => {
    // Optimistisches Update vor Server-Call
    updateRoomLocally(roomId, { automation_enabled: enabled });
    
    const success = await toggleAutomation(roomId, enabled);
    if (!success) {
      // Bei Fehler: Zustand zurücksetzen
      updateRoomLocally(roomId, { automation_enabled: !enabled });
    }
  }, [toggleAutomation, updateRoomLocally]);

  const handleRefreshRoom = useCallback(async (roomId: string) => {
    await syncAllStatus();
    await loadRooms();
  }, [syncAllStatus, loadRooms]);

  const handleCancelOverride = useCallback(async (roomId: string) => {
    // Optimistisches Update
    updateRoomLocally(roomId, { manual_override_until: null });
    
    // Server-Update
    await saveRoom({ id: roomId, manual_override_until: null }, true);
  }, [saveRoom, updateRoomLocally]);

  const handleAnalyze = () => {
    analyzeHeating(readings, settings);
  };

  const handleAnalyzeRooms = async () => {
    if (rooms.length === 0) {
      toast.error('Bitte lege zuerst Räume an');
      return;
    }
    
    if (readings.length < 5) {
      toast.error('Nicht genügend Energiedaten für Analyse');
      return;
    }

    setIsAnalyzingRooms(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: { 
          readings: readings.slice(-100),
          heatingSettings: settings,
          rooms: rooms,
          type: 'room_heating_optimization'
        }
      });

      if (error) throw error;

      if (data.roomHeatingPlan) {
        const plan = data.roomHeatingPlan;
        setRoomStrategy(plan.strategy || '');
        
        // Map room names to room IDs and save recommendations
        // WICHTIG: Lokales Datum für korrekte Zeitzonen-Behandlung
        const today = getLocalDateString();
        const newRecommendations = plan.rooms.flatMap((roomPlan: any) => {
          const room = rooms.find(r => r.name === roomPlan.room_name);
          if (!room?.id) return [];
          
          // Create current period recommendation
          // Explizit Wiener Zeit verwenden
          const currentHour = getViennaHour();
          const currentPeriod = roomPlan.periods?.find((p: any) => {
            const startHour = parseInt(p.start_time.split(':')[0]);
            const endHour = parseInt(p.end_time.split(':')[0]);
            return currentHour >= startHour && currentHour < endHour;
          }) || roomPlan.periods?.[0];
          
          return {
            room_id: room.id,
            date: today,
            period_number: 1,
            start_time: currentPeriod?.start_time || '06:00',
            end_time: currentPeriod?.end_time || '22:00',
            recommended_temp: roomPlan.recommended_temp,
            reason: roomPlan.reason,
            priority: roomPlan.priority
          };
        });

        await saveRoomRecommendations(newRecommendations);
        await loadRoomRecommendations();
        toast.success('Raumspezifische Empfehlungen erstellt');
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Room analysis error:', error);
      toast.error('Fehler bei der Raumanalyse');
    } finally {
      setIsAnalyzingRooms(false);
    }
  };

  const latestSoc = currentReading?.battery_soc ?? null;
  const latestPvPower = currentReading?.pv_power ?? null;

  return (
    <div className="space-y-6">
      {/* API Error Banner */}
      <ApiErrorBanner onRetry={() => { syncAllStatus(); refetchErrors(); }} />
      
      {/* Current Status Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 w-full min-w-0">
        <BatteryStatus 
          soc={latestSoc} 
          capacity={settings.battery_capacity_kwh}
          batteryPower={currentReading?.battery_power ?? null}
        />
        
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sun className="w-4 h-4 text-energy-export" />
              PV-Leistung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Label "Heute" */}
            <p className="text-xs text-muted-foreground">Heute</p>
            
            {/* Tagesproduktion als große Zahl */}
            <div className="text-xl sm:text-2xl font-bold font-mono text-energy-export">
              {isLoadingPv ? '...' : `${pvEnergy.toFixed(1)} kWh`}
            </div>
            
            {/* Progress-Bar und Prognose-Vergleich */}
            {todayForecast && todayForecast.expected_kwh > 0 && (
              <div className="space-y-1.5">
                <Progress 
                  value={Math.min((pvEnergy / todayForecast.expected_kwh) * 100, 100)} 
                  className="h-2"
                />
                <p className={`text-xs text-right font-medium ${
                  (pvEnergy / todayForecast.expected_kwh) >= 0.8 
                    ? 'text-green-500' 
                    : (pvEnergy / todayForecast.expected_kwh) >= 0.5 
                      ? 'text-yellow-500' 
                      : 'text-muted-foreground'
                }`}>
                  {Math.round((pvEnergy / todayForecast.expected_kwh) * 100)}% der Prognose ({todayForecast.expected_kwh.toFixed(1)} kWh)
                </p>
              </div>
            )}
            
            {/* Aktuelle Leistung als kleine Info */}
            <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
              <span>Aktuell</span>
              <span className="font-mono">
                {latestPvPower !== null ? `${(latestPvPower / 1000).toFixed(1)} kW` : '—'}
              </span>
            </div>
            
            <p className="text-xs text-muted-foreground">
              Anlage: {settings.pv_capacity_kwp} kWp
            </p>
          </CardContent>
        </Card>

        <AIStatusWidget 
          rooms={rooms} 
          pvPower={latestPvPower} 
          soc={latestSoc} 
        />

        <MLFollowRateWidget />

        {/* PV Forecast Card */}
        <PvForecastCard
          todayForecast={todayForecast}
          tomorrowForecast={tomorrowForecast}
          weekForecasts={forecasts}
          onRefresh={fetchForecast}
          isRefreshing={isFetching}
          pvCapacity={settings.pv_capacity_kwp}
        />

        <BatteryReserveStatus currentSoc={latestSoc ?? undefined} />

      </div>

      {/* Heating & Cost Overview - 2 columns */}
      <div className="grid md:grid-cols-2 gap-4">
        <HeatingOverviewCard rooms={rooms} />
        <EnergyCostWidget
          energyIn={energyIn}
          energyOut={energyOut}
          pvEnergy={pvEnergy}
          electricityPriceCent={settings.electricity_price_kwh_cent ?? 20.28}
          feedInPriceCent={settings.feed_in_price_kwh_cent ?? 8.0}
          baseFeePerYearEur={settings.electricity_base_fee_year_eur ?? 36.0}
        />
      </div>

      {/* AI Settings Suggestions */}
      <AISettingsSuggestions />

      {/* Heating History Chart */}
      <HeatingHistoryChart rooms={rooms} />

      {/* Solar Gain Chart - Temperature vs PV */}
      <SolarGainChart rooms={rooms} />

      {/* Thermostat Control - show if any rooms have tuya devices */}
      {rooms.some(r => r.tuya_device_id) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-primary" />
                Thermostat-Steuerung
              </CardTitle>
              <CardDescription>
                Live-Temperaturen und manuelle Steuerung · <span className={isLocalMode ? 'text-primary font-medium' : 'font-medium'}>{modeLabel}</span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {lastSyncTime && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(lastSyncTime, 'HH:mm')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await pushAllTemps();
                  await loadRooms();
                }}
                disabled={isPushing || isSyncing}
                title={pushTooltip}
              >
                {isPushing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Alle pushen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncThermostats}
                disabled={isSyncing || isPushing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 w-full min-w-0">
              {rooms.filter(r => r.tuya_device_id).map(room => (
                <ThermostatCard
                  key={room.id}
                  room={room}
                  onSetTemperature={handleSetTemperature}
                  onTogglePvAuto={handleTogglePvAuto}
                  onToggleAutomation={handleToggleAutomation}
                  onCancelOverride={handleCancelOverride}
                  onRefresh={handleRefreshRoom}
                  isLoading={isSyncing}
                  heatingStats={room.id ? getRoomStats(room.id) : undefined}
                  nightStartTime={settings.night_start_time ?? '22:00'}
                  nightEndTime={settings.night_end_time ?? '06:00'}
                  hasApiError={room.id ? hasRoomError(room.id) : false}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Heating Schedule - Primary view */}
      {rooms.length > 0 && (
        <DailyHeatingSchedule
          rooms={rooms}
          settings={settings}
          currentSurplus={currentReading?.pv_power ? currentReading.pv_power - (currentReading.consumption || 0) : null}
          batterySoc={currentReading?.battery_soc ?? null}
        />
      )}

    </div>
  );
}

// getAutomationStatus moved to AIStatusWidget.tsx
