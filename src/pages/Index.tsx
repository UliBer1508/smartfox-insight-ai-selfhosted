import { useState, useEffect, useCallback } from 'react';
import { getLocalDateString, getViennaHour } from '@/lib/dateUtils';
import { Header } from '@/components/energy/Header';
import { PowerGauge } from '@/components/energy/PowerGauge';
import { EnergyStats } from '@/components/energy/EnergyStats';
import { EnergyChart } from '@/components/energy/EnergyChart';
import { EnergyFlowDiagram } from '@/components/energy/EnergyFlowDiagram';
import { ConnectionStatus } from '@/components/energy/ConnectionStatus';
import { SettingsPanel } from '@/components/energy/SettingsPanel';
import { AnalysisPanel } from '@/components/energy/AnalysisPanel';
import { HeatingDashboard } from '@/components/heating/HeatingDashboard';
import { BatteryStatus } from '@/components/heating/BatteryStatus';
import { BatteryHistoryChart } from '@/components/energy/BatteryHistoryChart';
import { PowerStats } from '@/components/energy/PowerStats';
import { ConsumptionStats } from '@/components/energy/ConsumptionStats';
import { ConsumptionExplainer } from '@/components/energy/ConsumptionExplainer';
import { RoomRecommendations } from '@/components/heating/RoomRecommendations';
import { HeatingPeriodCard } from '@/components/heating/HeatingPeriodCard';
import { LearningProgress } from '@/components/heating/LearningProgress';
import { RoomStatusTable } from '@/components/heating/RoomStatusTable';


import { useSmartfoxSettings } from '@/hooks/useSmartfoxSettings';
import { useSmartfoxData } from '@/hooks/useSmartfoxData';
import { usePatternAnalysis } from '@/hooks/usePatternAnalysis';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useEnergyCalculation } from '@/hooks/useEnergyCalculation';
import { useHeatingAnalysis } from '@/hooks/useHeatingAnalysis';
import { useRooms } from '@/hooks/useRooms';
import { useAutomation } from '@/hooks/useAutomation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Database, Clock, Zap, Thermometer, Home, Loader2, Sun, Battery, Brain, Bot } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'analysis' | 'heating'>('dashboard');
  const { settings } = useSmartfoxSettings();
  const { settings: heatingSettings } = useHeatingSettings();
  const { 
    currentReading, 
    readings, 
    totalCount,
    isConnected, 
    lastError, 
    refresh 
  } = useSmartfoxData();
  const { 
    analysis, 
    isAnalyzing, 
    analyzeDailyPattern, 
    analyzeWeeklyComparison,
    loadDailyPatterns 
  } = usePatternAnalysis();

  const { energyIn, energyOut, pvEnergy, hasDataGaps, largestGapMinutes, isLoading: isLoadingPv } = useEnergyCalculation(readings);

  // Hooks für die Heizungs-Optimierung im Analyse-Tab
  const { 
    isAnalyzing: isHeatingAnalyzing, 
    analysisResult, 
    analyzeHeating 
  } = useHeatingAnalysis();
  const {
    rooms,
    getCurrentRecommendation,
    saveRoom,
    updateRoomLocally,
    saveRecommendations: saveRoomRecommendations,
    loadRecommendations: loadRoomRecommendations,
  } = useRooms();
  const {
    applyRecommendations,
    isApplying,
  } = useAutomation();

  const [isAnalyzingRooms, setIsAnalyzingRooms] = useState(false);
  const [roomStrategy, setRoomStrategy] = useState<string>('');

  useEffect(() => {
    loadDailyPatterns();
  }, [loadDailyPatterns]);

  // Handler für globale Heizungsanalyse
  const handleAnalyze = useCallback(() => {
    analyzeHeating(readings, heatingSettings);
  }, [analyzeHeating, readings, heatingSettings]);

  // Handler für raumspezifische Analyse
  const handleAnalyzeRooms = useCallback(async () => {
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
          heatingSettings: heatingSettings,
          rooms: rooms,
          type: 'room_heating_optimization'
        }
      });

      if (error) throw error;

      if (data.roomHeatingPlan) {
        const plan = data.roomHeatingPlan;
        setRoomStrategy(plan.strategy || '');
        
        // WICHTIG: Lokales Datum für korrekte Zeitzonen-Behandlung
        const today = getLocalDateString();
        const newRecommendations = plan.rooms.flatMap((roomPlan: any) => {
          const room = rooms.find(r => r.name === roomPlan.room_name);
          if (!room?.id) return [];
          
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
  }, [rooms, readings, heatingSettings, saveRoomRecommendations, loadRoomRecommendations]);

  return (
    <div className="min-h-screen bg-background grid-pattern overflow-x-hidden">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6 space-y-4 md:space-y-6 overflow-x-hidden box-border pb-24 md:pb-6">
        
        {activeTab === 'dashboard' && (
          <>
            <ConnectionStatus
              isConnected={isConnected}
              lastUpdate={currentReading?.timestamp}
              error={lastError}
              onRefresh={refresh}
            />

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <EnergyFlowDiagram
                  pvPower={currentReading?.pv_power ?? null}
                  consumption={currentReading?.consumption ?? null}
                  batteryPower={currentReading?.battery_power ?? null}
                  gridPower={currentReading?.power_io ?? 0}
                  batterySoc={currentReading?.battery_soc ?? null}
                />

                <BatteryStatus 
                  soc={currentReading?.battery_soc ?? null}
                  capacity={heatingSettings.battery_capacity_kwh}
                  batteryPower={currentReading?.battery_power ?? null}
                />

                {/* PV-Leistung und Verbrauch */}
                <div className="grid grid-cols-2 gap-3">
                  <PowerStats pvPower={currentReading?.pv_power ?? null} />
                  <ConsumptionStats consumption={currentReading?.consumption ?? null} />
                </div>
              </div>

              {/* Rechte Spalte: Statistiken, Chart und aktive Verbraucher */}
              <div className="lg:col-span-2 space-y-6">
                <EnergyStats
                  energyIn={energyIn}
                  energyOut={energyOut}
                  pvEnergy={pvEnergy}
                  electricityPriceCent={heatingSettings.electricity_price_kwh_cent}
                  feedInPriceCent={heatingSettings.feed_in_price_kwh_cent}
                  hasDataGaps={hasDataGaps}
                  largestGapMinutes={largestGapMinutes}
                />
                
                <RoomStatusTable rooms={rooms} onSavePriority={async (roomId, priority) => {
                  const room = rooms.find(r => r.id === roomId);
                  const oldPriority = room?.priority ?? 5;
                  updateRoomLocally(roomId, { priority });
                  const success = await saveRoom({ id: roomId, priority }, true);
                  if (!success) {
                    updateRoomLocally(roomId, { priority: oldPriority });
                  }
                }} />
                <EnergyChart readings={readings} />
                
                <ConsumptionExplainer consumption={currentReading?.consumption ?? null} />
              </div>
            </div>

            <BatteryHistoryChart />

            {/* 3-Spalten Widget-Grid über volle Breite */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    Messungen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">{totalCount.toLocaleString('de-DE')}</div>
                  <p className="text-xs text-muted-foreground">gespeichert</p>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Intervall
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">{settings.polling_interval}s</div>
                  <p className="text-xs text-muted-foreground">Polling</p>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    Start
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold font-mono">
                    {readings.length > 0 
                      ? new Date(readings[readings.length - 1].timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
                      : '-'
                    }
                  </div>
                  <p className="text-xs text-muted-foreground">ältester Punkt</p>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            isConnected={isConnected}
            lastUpdate={currentReading?.timestamp}
          />
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-6">
            <AnalysisPanel
              readings={readings}
              analysis={analysis}
              isAnalyzing={isAnalyzing}
              onAnalyzeDaily={analyzeDailyPattern}
              onAnalyzeWeekly={analyzeWeeklyComparison}
            />

            {/* Heizungs-Optimierung */}
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
                    <TabsTrigger value="global" className="text-xs sm:text-sm px-1 sm:px-3">
                      <Thermometer className="w-4 h-4 sm:mr-2 flex-shrink-0" />
                      <span className="hidden sm:inline">TGP508 Global</span>
                      <span className="sm:hidden">Global</span>
                    </TabsTrigger>
                    <TabsTrigger value="rooms" className="text-xs sm:text-sm px-1 sm:px-3">
                      <Home className="w-4 h-4 sm:mr-2 flex-shrink-0" />
                      <span className="hidden sm:inline">Raumweise</span>
                      <span className="sm:hidden">Räume</span>
                    </TabsTrigger>
                    <TabsTrigger value="learning" className="text-xs sm:text-sm px-1 sm:px-3">
                      <Brain className="w-4 h-4 sm:mr-2 flex-shrink-0" />
                      <span className="hidden sm:inline">ML-Status</span>
                      <span className="sm:hidden">ML</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="global" className="space-y-4 mt-4">
                    <Button 
                      onClick={handleAnalyze}
                      disabled={isHeatingAnalyzing || readings.length < 5}
                      className="w-full md:w-auto"
                    >
                      {isHeatingAnalyzing ? (
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

                    {analysisResult?.periods && analysisResult.periods.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">📅 Empfohlener Heizplan für deinen TGP508:</h3>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {analysisResult.periods.map((period) => (
                            <HeatingPeriodCard key={period.period} period={period} />
                          ))}
                        </div>
                        
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

                    {analysisResult?.summary && (!analysisResult.periods || analysisResult.periods.length === 0) && (
                      <div className="p-4 rounded-lg border bg-card whitespace-pre-wrap text-sm">
                        {analysisResult.summary}
                      </div>
                    )}

                    {!analysisResult && !isHeatingAnalyzing && (
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

            {/* Aktuelle Thermostat-Empfehlungen */}
            {rooms.length > 0 && (
              <RoomRecommendations 
                rooms={rooms}
                getCurrentRecommendation={getCurrentRecommendation}
                strategy={roomStrategy}
              />
            )}
          </div>
        )}

        {activeTab === 'heating' && (
          <HeatingDashboard 
            readings={readings}
            currentReading={currentReading}
            energyIn={energyIn}
            energyOut={energyOut}
            pvEnergy={pvEnergy}
            isLoadingPv={isLoadingPv}
          />
        )}
      </main>
    </div>
  );
};

export default Index;
