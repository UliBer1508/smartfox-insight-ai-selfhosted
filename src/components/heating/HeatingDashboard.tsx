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
import { useApiErrors } from '@/hooks/useApiErrors';
import { HeatingPeriodCard } from './HeatingPeriodCard';
import { BatteryStatus } from './BatteryStatus';
import { BatteryReserveStatus } from './BatteryReserveStatus';
import { PvForecastCard } from './PvForecastCard';

import { HeatingOverviewCard } from './HeatingOverviewCard';
import { HeatingHistoryChart } from './HeatingHistoryChart';
import { SolarGainChart } from './SolarGainChart';
import { PvAccuracyChart } from './PvAccuracyChart';
import { EnergyCostWidget } from '@/components/energy/EnergyCostWidget';
import { PriceSuggestionBanner } from '@/components/energy/PriceSuggestionBanner';
import { AIStatusWidget } from './AIStatusWidget';
import { MLFollowRateWidget } from './MLFollowRateWidget';
import { ApiErrorBanner } from './ApiErrorBanner';
import { Zap, Sun, Brain, ChevronDown } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LearningProgress } from './LearningProgress';
import { PatternRecallBlock } from './PatternRecallBlock';
import { RoomStatusTable } from './RoomStatusTable';
import { DailyHeatingSchedule } from './DailyHeatingSchedule';

import { AIShadowDecisions } from './AIShadowDecisions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getLocalDateString, getViennaHour } from '@/lib/dateUtils';

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
    getCurrentRecommendation,
    loadRooms,
    updateRoomLocally
  } = useRooms();


  // Thermostat-Werte lesen: nur noch für "Erneut versuchen" im Fehlerbanner.
  // Lokal = DB neu laden, Cloud = tuya-control/sync-all (60-Min-Sperre + Kontingent).
  // Die frühere Karte "Thermostat-Steuerung" ist am 26.10.2026 entfallen:
  //   Übersteuern → Übersicht, Grundwerte + Automatik-Schalter → Einstellungen › Räume,
  //   Alle senden / Cloud-Lesung → Einstellungen › Betrieb.
  const { syncAllStatus } = useTuyaControl();

  const { refetch: refetchErrors } = useApiErrors();

  useEffect(() => {
    loadRecommendations();
    loadForecasts();
    // Räume aus DB neu laden (kein Tuya-Call)
    loadRooms();
  }, [loadRecommendations, loadForecasts, loadRooms]);

  // DB-Polling alle 60s für aktuelle Raumdaten — verursacht KEINE Tuya-Calls
  useEffect(() => {
    const dbPoll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadRooms();
    }, 60_000);
    return () => clearInterval(dbPoll);
  }, [loadRooms]);

  const handleAnalyze = () => {
    analyzeHeating(readings, settings);
  };


  const latestSoc = currentReading?.battery_soc ?? null;
  const latestPvPower = currentReading?.pv_power ?? null;

  return (
    <div className="space-y-6">
      {/* API Error Banner */}
      <ApiErrorBanner onRetry={async () => { await syncAllStatus({ silent: true }); await loadRooms(); refetchErrors(); }} />

      {/* Top 3 Status Cards */}
      <div className="grid md:grid-cols-3 gap-4 w-full min-w-0">
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
            <p className="text-xs text-muted-foreground">Heute</p>
            <div className="text-xl sm:text-2xl font-bold font-mono text-energy-export">
              {isLoadingPv ? '...' : `${pvEnergy.toFixed(1)} kWh`}
            </div>
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
      </div>

      {/* Heating & Cost Overview - 2 columns */}
      <div className="grid md:grid-cols-2 gap-4">
        <HeatingOverviewCard rooms={rooms} />
        <div className="space-y-2">
          <PriceSuggestionBanner />
          <EnergyCostWidget
            energyIn={energyIn}
            energyOut={energyOut}
            pvEnergy={pvEnergy}
            electricityPriceCent={settings.electricity_price_kwh_cent ?? 20.28}
            feedInPriceCent={settings.feed_in_price_kwh_cent ?? 8.0}
            baseFeePerYearEur={settings.electricity_base_fee_year_eur ?? 36.0}
          />
        </div>
      </div>

      {/* KI-Parameter-Vorschläge */}
      <AIShadowDecisions />

      {/* Raumpriorität & Status */}
      {rooms.length > 0 && (
        <RoomStatusTable
          rooms={rooms}
          onSavePriority={async (roomId, priority) => {
            const room = rooms.find(r => r.id === roomId);
            const oldPriority = room?.priority ?? 5;
            updateRoomLocally(roomId, { priority });
            const success = await saveRoom({ id: roomId, priority }, true);
            if (!success) updateRoomLocally(roomId, { priority: oldPriority });
          }}
        />
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

      {/* KI-Lernstatus & Mustergedächtnis — aufklappbar */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                🧠 KI-Lernstatus &amp; Mustergedächtnis
                <ChevronDown className="w-4 h-4 ml-auto transition-transform data-[state=open]:rotate-180" />
              </CardTitle>
              <CardDescription>
                ML-Konfidenz, Reward-History und erkannte Wochenmuster.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <PatternRecallBlock />
              <LearningProgress />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Detailansicht KI & Prognose — aufklappbar */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                📊 Detailansicht KI &amp; Prognose
                <ChevronDown className="w-4 h-4 ml-auto transition-transform data-[state=open]:rotate-180" />
              </CardTitle>
              <CardDescription>
                PV-Prognose basiert auf Wetterdaten. Die Batterie-Reserve zeigt wieviel Kapazität die KI
                für Nacht/Morgen freihält. Die ML-Follow-Rate misst wie zuverlässig die KI-Empfehlungen
                ausgeführt werden.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <PvForecastCard
                  todayForecast={todayForecast}
                  tomorrowForecast={tomorrowForecast}
                  weekForecasts={forecasts}
                  onRefresh={fetchForecast}
                  isRefreshing={isFetching}
                  pvCapacity={settings.pv_capacity_kwp}
                />
                <BatteryReserveStatus currentSoc={latestSoc ?? undefined} />
                <MLFollowRateWidget />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Verlaufscharts — aufklappbar */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                📈 Verlaufscharts
                <ChevronDown className="w-4 h-4 ml-auto transition-transform data-[state=open]:rotate-180" />
              </CardTitle>
              <CardDescription>
                Heizverlauf der letzten Tage sowie Korrelation Temperatur ↔ PV-Ertrag.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-6">
              <HeatingHistoryChart rooms={rooms} />
              <SolarGainChart rooms={rooms} />
              <PvAccuracyChart />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

// getAutomationStatus moved to AIStatusWidget.tsx
