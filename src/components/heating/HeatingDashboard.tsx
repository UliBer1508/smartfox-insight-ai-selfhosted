import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EnergyReading } from '@/types/energy';
import { HeatingSettings, HeatingAnalysisResult } from '@/types/heating';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { useHeatingAnalysis } from '@/hooks/useHeatingAnalysis';
import { usePvForecast } from '@/hooks/usePvForecast';
import { HeatingPeriodCard } from './HeatingPeriodCard';
import { HeatingSettingsForm } from './HeatingSettingsForm';
import { BatteryStatus } from './BatteryStatus';
import { PvForecastCard } from './PvForecastCard';
import { Thermometer, Loader2, Zap, Sun, Battery } from 'lucide-react';

interface HeatingDashboardProps {
  readings: EnergyReading[];
  currentReading: EnergyReading | null;
}

export function HeatingDashboard({ readings, currentReading }: HeatingDashboardProps) {
  const { settings, saveSettings, isLoading: settingsLoading } = useHeatingSettings();
  const { 
    isAnalyzing, 
    analysisResult, 
    recommendations,
    loadRecommendations,
    analyzeHeating 
  } = useHeatingAnalysis();
  const {
    forecasts,
    todayForecast,
    tomorrowForecast,
    isFetching,
    loadForecasts,
    fetchForecast,
  } = usePvForecast();

  useEffect(() => {
    loadRecommendations();
    loadForecasts();
  }, [loadRecommendations, loadForecasts]);

  const handleAnalyze = () => {
    analyzeHeating(readings, settings);
  };

  const latestSoc = currentReading?.battery_soc ?? null;
  const latestPvPower = currentReading?.pv_power ?? null;

  return (
    <div className="space-y-6">
      {/* Current Status Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <BatteryStatus 
          soc={latestSoc} 
          capacity={settings.battery_capacity_kwh} 
        />
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sun className="w-4 h-4 text-energy-export" />
              PV-Leistung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-energy-export">
              {latestPvPower !== null ? `${(latestPvPower / 1000).toFixed(1)} kW` : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              Anlage: {settings.pv_capacity_kwp} kWp
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" />
              Heizungsstatus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
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

      {/* Analysis Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Heizungs-Optimierung für TGP508
          </CardTitle>
          <CardDescription>
            KI-basierte Thermostat-Empfehlungen für deine 6 Zeitperioden
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Settings */}
      <HeatingSettingsForm 
        settings={settings} 
        onSave={saveSettings}
        isLoading={settingsLoading}
      />
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
  
  if (soc !== null && soc < settings.target_battery_soc) {
    return '🔋 Batterie laden';
  }
  
  if (pvKw > 2) {
    return '☀️ Jetzt heizen!';
  }
  
  if (pvKw > 0.5) {
    return '⚡ Wärme halten';
  }
  
  return '❄️ Energie sparen';
}
