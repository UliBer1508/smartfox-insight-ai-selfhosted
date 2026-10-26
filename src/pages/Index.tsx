// Hauptseite: 4 Tabs nach Zweck (seit 26.10.2026)
//   Übersicht      – ansehen, jetzt (Status, Fehler, Energiefluss, Räume, kurz übersteuern)
//   Analyse        – Rückblick Tag/Woche/Monat/Jahr, mit Einstellungs-Vorschlägen nach Bestätigung
//   KI             – prüfen und entscheiden (Vorschläge, Tagesplan, Lernstatus, Auswertungen)
//   Einstellungen  – wie das System arbeiten soll (inkl. Abschnitt KI)
// Die früheren Tabs Energie, Heizung & KI und Verlauf & Muster sind darin aufgegangen
// (Umzugsliste: doc/NEUE-TAB-STRUKTUR-2026-10-26.md).
import { useState, useEffect } from 'react';
import { SEO } from '@/components/SEO';
import { Header, AppTab } from '@/components/energy/Header';
import { SettingsPanel } from '@/components/energy/SettingsPanel';
import { HouseOverview } from '@/components/overview/HouseOverview';
import { AnalysisTab } from '@/components/analysis/AnalysisTab';
import { KiTab } from '@/components/ki/KiTab';
import { useSmartfoxSettings } from '@/hooks/useSmartfoxSettings';
import { useSmartfoxData } from '@/hooks/useSmartfoxData';
import { usePatternAnalysis } from '@/hooks/usePatternAnalysis';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useEnergyCalculation } from '@/hooks/useEnergyCalculation';
import { useRooms } from '@/hooks/useRooms';

const Index = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const { settings } = useSmartfoxSettings();
  const { settings: heatingSettings } = useHeatingSettings();
  const { currentReading, readings, totalCount, isConnected } = useSmartfoxData();
  const { analysis, isAnalyzing, analyzeDailyPattern, analyzeWeeklyComparison, loadDailyPatterns } = usePatternAnalysis();
  const { energyIn, energyOut, pvEnergy } = useEnergyCalculation(readings);
  const { rooms, updateRoomLocally } = useRooms();

  useEffect(() => {
    loadDailyPatterns();
  }, [loadDailyPatterns]);

  const tabMeta: Record<AppTab, { title: string; description: string }> = {
    overview: {
      title: 'Übersicht — Heizung Venediger',
      description: 'Betriebsmodus, Energie, Wetter- und PV-Prognose sowie alle Räume auf einen Blick.',
    },
    analysis: {
      title: 'Analyse — Heizung Venediger',
      description: 'Rückblick auf Tag, Woche, Monat und Jahr: PV, Batterie, Heizung je Raum, Prognose und Kosten.',
    },
    ki: {
      title: 'KI — Heizung Venediger',
      description: 'KI-Vorschläge prüfen und entscheiden, Tagesplan, Lernstatus und Musteranalyse.',
    },
    settings: {
      title: 'Einstellungen — Heizung Venediger',
      description: 'Betrieb, Haus, Räume, KI und System.',
    },
  };
  const meta = tabMeta[activeTab];
  const navigate = (tab: AppTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex-1 flex flex-col bg-background grid-pattern overflow-x-hidden">
      <SEO title={meta.title} description={meta.description} path="/" />
      <Header activeTab={activeTab} onTabChange={navigate} />

      <main className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6 space-y-4 md:space-y-6 overflow-x-hidden box-border pb-24 md:pb-6">
        {activeTab === 'overview' && (
          <HouseOverview
            currentReading={currentReading}
            isConnected={isConnected}
            rooms={rooms}
            settings={heatingSettings}
            updateRoomLocally={updateRoomLocally}
            onNavigate={navigate}
          />
        )}

        {activeTab === 'analysis' && (
          <AnalysisTab
            rooms={rooms}
            settings={heatingSettings}
            todayEnergy={{ energyIn, energyOut, pvEnergy }}
            onNavigate={navigate}
          />
        )}

        {activeTab === 'ki' && (
          <KiTab
            rooms={rooms}
            currentReading={currentReading}
            readings={readings}
            pattern={{ analysis, isAnalyzing, analyzeDailyPattern, analyzeWeeklyComparison }}
            onNavigate={navigate}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            isConnected={isConnected}
            lastUpdate={currentReading?.timestamp}
            systemInfo={{
              totalCount,
              pollingInterval: settings.polling_interval,
              oldest: readings.length > 0 ? readings[readings.length - 1].timestamp : null,
            }}
          />
        )}
      </main>
    </div>
  );
};

export default Index;
