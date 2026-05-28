import { useState, useEffect } from 'react';
import { getLocalDateString, getViennaHour } from '@/lib/dateUtils';
import { SEO } from '@/components/SEO';
import { Header } from '@/components/energy/Header';
import { PowerGauge } from '@/components/energy/PowerGauge';
import { EnergyStats } from '@/components/energy/EnergyStats';
import { EnergyChart } from '@/components/energy/EnergyChart';
import { EnergyFlowDiagram } from '@/components/energy/EnergyFlowDiagram';
import { ConnectionStatus } from '@/components/energy/ConnectionStatus';
import { SettingsPanel } from '@/components/energy/SettingsPanel';
import { AnalysisPanel } from '@/components/energy/AnalysisPanel';
import { HeatingDashboard } from '@/components/heating/HeatingDashboard';
import { BatteryHistoryChart } from '@/components/energy/BatteryHistoryChart';



import { AutomationStatusCard, BatterySocHistoryCard } from '@/components/heating/AutomationStatusCards';



import { useSmartfoxSettings } from '@/hooks/useSmartfoxSettings';
import { useSmartfoxData } from '@/hooks/useSmartfoxData';
import { usePatternAnalysis } from '@/hooks/usePatternAnalysis';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useEnergyCalculation } from '@/hooks/useEnergyCalculation';

import { useRooms } from '@/hooks/useRooms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Activity, Database, Clock, Thermometer, Home, Brain } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
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

  const {
    rooms,
  } = useRooms();

  useEffect(() => {
    loadDailyPatterns();
  }, [loadDailyPatterns]);




  const tabMeta: Record<typeof activeTab, { title: string; description: string }> = {
    dashboard: {
      title: 'Übersicht — Fronius Smart AI',
      description: 'Live-Übersicht von PV-Erzeugung, Batterie-Speicher, Verbrauch und aktiver Heizungsleistung in Echtzeit.',
    },
    heating: {
      title: 'Heizung & KI — Fronius Smart AI',
      description: 'Intelligente Heizungssteuerung mit PV-Überschuss-Optimierung, Raumprioritäten, KI-Lernstatus und Nachtmodus für 12 Tuya-Thermostate.',
    },
    analysis: {
      title: 'Verlauf & Muster — Fronius Smart AI',
      description: 'Tages-, Wochen- und Monatsanalyse von Heiz- und Energieverhalten mit KI-gestützter Mustererkennung.',
    },
    settings: {
      title: 'Einstellungen — Fronius Smart AI',
      description: 'Konfiguration von Smartfox, Tuya, Heizungsparametern, Datenaufbewahrung und Energiekosten.',
    },
  };
  const meta = tabMeta[activeTab];

  return (
    <div className="flex-1 flex flex-col bg-background grid-pattern overflow-x-hidden">
      <SEO title={meta.title} description={meta.description} path="/" />
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

            {/* KI-Vorschlag prominent ganz oben anzeigen (nur wenn pending) */}
            <BatterySocSuggestionCard />

            {/* Automations-Status: immer sichtbar direkt unter Verbindung */}
            <AutomationStatusCard />



            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <EnergyFlowDiagram
                  pvPower={currentReading?.pv_power ?? null}
                  consumption={currentReading?.consumption ?? null}
                  batteryPower={currentReading?.battery_power ?? null}
                  gridPower={currentReading?.power_io ?? 0}
                  batterySoc={currentReading?.battery_soc ?? null}
                />

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
                
                {/* Verlaufs-Karte bleibt in rechter Spalte (nur sichtbar wenn history > 0) */}
                <BatterySocHistoryCard />

                <EnergyChart readings={readings} />
              </div>
            </div>

            <BatteryHistoryChart />

            {/* Systeminfo aufklappbar */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="sysinfo" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-2 bg-muted/30 text-sm hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-muted-foreground" />
                    Systeminfo
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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

            {/* Räume-Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Home className="w-5 h-5 text-primary" />
                  Räume &amp; Automatik
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rooms.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Home className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Lege zuerst Räume an, um die KI-Automatik nutzen zu können.</p>
                    <p className="text-xs mt-2">Gehe zu Einstellungen → Räume verwalten.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                    <p className="font-medium flex items-center gap-2">
                      <Brain className="w-4 h-4 text-primary" />
                      KI-Autopilot aktiv
                    </p>
                    <p className="text-muted-foreground">
                      {rooms.length} Räume werden vollautomatisch über die PV-Automation und den
                      KI-Parameter-Advisor gesteuert. Status, Live-Werte und KI-Lernfortschritt
                      findest du im Tab <strong>Heizung &amp; KI</strong>.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
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
