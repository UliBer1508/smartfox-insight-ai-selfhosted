import { useState, useEffect } from 'react';
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
import { ConsumptionExplainer } from '@/components/energy/ConsumptionExplainer';
import { useSmartfoxSettings } from '@/hooks/useSmartfoxSettings';
import { useSmartfoxData } from '@/hooks/useSmartfoxData';
import { usePatternAnalysis } from '@/hooks/usePatternAnalysis';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useEnergyCalculation } from '@/hooks/useEnergyCalculation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Database, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

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

  const { energyIn, energyOut } = useEnergyCalculation(readings);

  useEffect(() => {
    loadDailyPatterns();
  }, [loadDailyPatterns]);

  return (
    <div className="min-h-screen bg-background grid-pattern overflow-x-hidden">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6 overflow-hidden box-border">
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

                {/* PV-Leistung und Verbrauch+Aktive Verbraucher nebeneinander */}
                <div className="grid grid-cols-2 gap-3">
                  <PowerStats pvPower={currentReading?.pv_power ?? null} />
                  <ConsumptionExplainer consumption={currentReading?.consumption ?? null} />
                </div>
              </div>

              <div className="lg:col-span-2 space-y-6">
                <EnergyStats
                  energyIn={energyIn}
                  energyOut={energyOut}
                />
                
                <EnergyChart readings={readings} />
              </div>
            </div>

            {/* 3-Spalten Widget-Grid über volle Breite */}
            <div className="grid grid-cols-3 gap-4">
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
                      ? format(new Date(readings[readings.length - 1].timestamp), 'dd.MM. HH:mm', { locale: de })
                      : '-'
                    }
                  </div>
                  <p className="text-xs text-muted-foreground">ältester Punkt</p>
                </CardContent>
              </Card>
            </div>

            <BatteryHistoryChart />
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

            <EnergyChart readings={readings} title="Daten für Analyse" />
          </div>
        )}

        {activeTab === 'heating' && (
          <HeatingDashboard 
            readings={readings}
            currentReading={currentReading}
          />
        )}
      </main>
    </div>
  );
};

export default Index;
