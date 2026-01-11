import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnergyReading } from '@/types/energy';
import { HeatingSettings } from '@/types/heating';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useHeatingAnalysis } from '@/hooks/useHeatingAnalysis';
import { usePvForecast } from '@/hooks/usePvForecast';
import { useRooms } from '@/hooks/useRooms';
import { useTuyaControl } from '@/hooks/useTuyaControl';
import { useRoomHeatingLogs } from '@/hooks/useRoomHeatingLogs';
import { useAutomation } from '@/hooks/useAutomation';
import { HeatingPeriodCard } from './HeatingPeriodCard';
import { BatteryStatus } from './BatteryStatus';
import { PvForecastCard } from './PvForecastCard';
import { RoomRecommendations } from './RoomRecommendations';
import { ThermostatCard } from './ThermostatCard';
import { HeatingOverviewCard } from './HeatingOverviewCard';
import { HeatingHistoryChart } from './HeatingHistoryChart';
import { SolarGainChart } from './SolarGainChart';
import { EnergyCostWidget } from '@/components/energy/EnergyCostWidget';
import { Thermometer, Loader2, Zap, Sun, Battery, Home, RefreshCw, Clock, Bot, Brain } from 'lucide-react';
import { LearningProgress } from './LearningProgress';
import { DailyHeatingSchedule } from './DailyHeatingSchedule';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface HeatingDashboardProps {
  readings: EnergyReading[];
  currentReading: EnergyReading | null;
  energyIn: number;
  energyOut: number;
  pvEnergy: number;
}

export function HeatingDashboard({ readings, currentReading, energyIn, energyOut, pvEnergy }: HeatingDashboardProps) {
  const { settings } = useHeatingSettings();
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

  const [isAnalyzingRooms, setIsAnalyzingRooms] = useState(false);
  const [roomStrategy, setRoomStrategy] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    loadRecommendations();
    loadForecasts();
    loadHeatingLogs();
  }, [loadRecommendations, loadForecasts, loadHeatingLogs]);

  // Auto-sync thermostats every 5 minutes
  useEffect(() => {
    const doSync = async () => {
      // Only sync if page is visible
      if (document.visibilityState !== 'visible') {
        console.log('[Auto-Sync] Skipped - page not visible');
        return;
      }
      
      console.log('[Auto-Sync] Syncing thermostats...');
      await syncAllStatus();
      await loadRooms();
      await loadHeatingLogs();
      setLastSyncTime(new Date());
    };

    // Initial sync
    doSync();

    // Set up periodic sync
    syncIntervalRef.current = setInterval(doSync, SYNC_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [syncAllStatus, loadRooms, loadHeatingLogs]);

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
        const today = new Date().toISOString().split('T')[0];
        const newRecommendations = plan.rooms.flatMap((roomPlan: any) => {
          const room = rooms.find(r => r.name === roomPlan.room_name);
          if (!room?.id) return [];
          
          // Create current period recommendation
          const now = new Date();
          const currentHour = now.getHours();
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
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold font-mono text-energy-export">
              {latestPvPower !== null ? `${(latestPvPower / 1000).toFixed(1)} kW` : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              Anlage: {settings.pv_capacity_kwp} kWp
            </p>
          </CardContent>
        </Card>

          <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" />
              Heizungsstatus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {getHeatingRecommendation(latestPvPower, latestSoc, settings)}
            </div>
            <p className="text-xs text-muted-foreground">aktuelle Empfehlung</p>
          </CardContent>
        </Card>

        {/* PV Forecast Card */}
        <PvForecastCard
          todayForecast={todayForecast}
          tomorrowForecast={tomorrowForecast}
          weekForecasts={forecasts}
          onRefresh={fetchForecast}
          isRefreshing={isFetching}
          pvCapacity={settings.pv_capacity_kwp}
        />

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
        />
      </div>

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
                Live-Temperaturen und manuelle Steuerung
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {lastSyncTime && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(lastSyncTime, 'HH:mm')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncThermostats}
                disabled={isSyncing}
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

      {/* Room Recommendations - show if rooms exist */}
      {rooms.length > 0 && (
        <RoomRecommendations 
          rooms={rooms}
          getCurrentRecommendation={getCurrentRecommendation}
          strategy={roomStrategy}
        />
      )}

      {/* Analysis Section with Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Heizungs-Optimierung
          </CardTitle>
          <CardDescription>
            KI-basierte Thermostat-Empfehlungen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue={rooms.length > 0 ? "rooms" : "global"} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="global">
                <Thermometer className="w-4 h-4 mr-2" />
                TGP508 Global
              </TabsTrigger>
              <TabsTrigger value="rooms">
                <Home className="w-4 h-4 mr-2" />
                Raumweise
              </TabsTrigger>
              <TabsTrigger value="learning">
                <Brain className="w-4 h-4 mr-2" />
                ML-Status
              </TabsTrigger>
            </TabsList>

            <TabsContent value="global" className="space-y-4 mt-4">
              <Button 
                onClick={handleAnalyze}
                disabled={isAnalyzing || readings.length < 5}
                className="w-full md:w-auto"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analysiere...
                  </>
                ) : (
                  <>
                    <Thermometer className="w-4 h-4 mr-2" />
                    Heizplan generieren
                  </>
                )}
              </Button>

              {/* Thermostat Periods */}
              {analysisResult?.periods && analysisResult.periods.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">📅 Empfohlener Heizplan für deinen TGP508:</h3>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {analysisResult.periods.map((period) => (
                      <HeatingPeriodCard key={period.period} period={period} />
                    ))}
                  </div>
                  
                  {/* Summary */}
                  <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
                    <p className="flex items-center gap-2 text-sm">
                      <Sun className="w-4 h-4 text-energy-export" />
                      <strong>Erwarteter PV-Überschuss:</strong> ~{analysisResult.expectedPvSurplus.toFixed(1)} kWh
                    </p>
                    <p className="flex items-center gap-2 text-sm">
                      <Battery className="w-4 h-4 text-primary" />
                      <strong>Batterie-Strategie:</strong> {analysisResult.batteryStrategy}
                    </p>
                    {analysisResult.recommendations.map((rec, i) => (
                      <p key={i} className="text-sm text-muted-foreground">💡 {rec}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Analysis Fallback */}
              {analysisResult?.summary && (!analysisResult.periods || analysisResult.periods.length === 0) && (
                <div className="p-4 rounded-lg border bg-card whitespace-pre-wrap text-sm">
                  {analysisResult.summary}
                </div>
              )}

              {!analysisResult && !isAnalyzing && (
                <div className="text-center py-8 text-muted-foreground">
                  <Thermometer className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Klicke auf &quot;Heizplan generieren&quot; für optimierte Thermostat-Zeiten.</p>
                  <p className="text-xs mt-2">Basierend auf deinen PV- und Batterie-Daten.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="rooms" className="space-y-4 mt-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={handleAnalyzeRooms}
                  disabled={isAnalyzingRooms || readings.length < 5 || rooms.length === 0}
                  className="w-full sm:w-auto"
                >
                  {isAnalyzingRooms ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analysiere Räume...
                    </>
                  ) : (
                    <>
                      <Home className="w-4 h-4 mr-2" />
                      Raumempfehlungen erstellen
                    </>
                  )}
                </Button>
                <Button 
                  onClick={applyRecommendations}
                  disabled={isApplying || rooms.length === 0}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  {isApplying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Wende an...
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4 mr-2" />
                      Empfehlungen anwenden
                    </>
                  )}
                </Button>
              </div>

              {rooms.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Home className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Lege zuerst Räume an, um raumspezifische Empfehlungen zu erhalten.</p>
                  <p className="text-xs mt-2">Gehe zu Einstellungen → Räume verwalten.</p>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {rooms.length} Räume konfiguriert. Klicke auf &quot;Raumempfehlungen erstellen&quot; für individuelle Temperaturempfehlungen.
                </div>
              )}
            </TabsContent>

            <TabsContent value="learning" className="mt-4">
              <LearningProgress />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function getHeatingRecommendation(
  pvPower: number | null, 
  soc: number | null, 
  settings: HeatingSettings
): string {
  if (pvPower === null) return 'Keine Daten';
  
  const pvKw = pvPower / 1000;
  const targetSoc = settings.target_battery_soc ?? 80;
  const hasGoodSoc = soc !== null && soc >= targetSoc;
  const hasUsableSoc = soc !== null && soc > 60;
  
  // Priorität 1: Viel PV-Leistung (> 2 kW)
  if (pvKw > 2) {
    if (!hasGoodSoc) {
      return '🔋⚡ Laden + heizen';
    }
    return '☀️ Jetzt heizen!';
  }
  
  // Priorität 2: Mittlerer PV-Ertrag (0.5-2 kW)
  if (pvKw > 0.5) {
    if (!hasGoodSoc) {
      return '🔋 Batterie laden';
    }
    return '⚡ Wärme halten';
  }
  
  // Priorität 3: Wenig/keine PV (< 0.5 kW)
  if (hasUsableSoc) {
    return '🔋 Batterie nutzbar';
  }
  
  return '❄️ Energie sparen';
}
