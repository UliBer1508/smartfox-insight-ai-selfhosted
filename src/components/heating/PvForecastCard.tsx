import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PvForecast } from '@/types/heating';
import { Sun, Cloud, CloudSun, RefreshCw, Loader2, Sunrise, Sunset } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

interface PvForecastCardProps {
  todayForecast: PvForecast | undefined;
  tomorrowForecast: PvForecast | undefined;
  weekForecasts: PvForecast[];
  onRefresh: () => void;
  isRefreshing: boolean;
  pvCapacity: number;
}

export function PvForecastCard({ 
  todayForecast, 
  tomorrowForecast, 
  weekForecasts,
  onRefresh, 
  isRefreshing,
  pvCapacity 
}: PvForecastCardProps) {
  const getWeatherIcon = (kwh: number) => {
    // Estimate based on theoretical max (~5.5h peak sun at 15.8kWp = ~87kWh theoretical max in summer)
    // Winter max might be ~30-40kWh on a perfect day
    const ratio = kwh / (pvCapacity * 3); // Rough estimate for typical good day
    
    if (ratio > 0.7) return <Sun className="w-6 h-6 text-yellow-500" />;
    if (ratio > 0.4) return <CloudSun className="w-6 h-6 text-orange-400" />;
    return <Cloud className="w-6 h-6 text-muted-foreground" />;
  };

  const getWeatherText = (kwh: number) => {
    const ratio = kwh / (pvCapacity * 3);
    if (ratio > 0.7) return 'Sonnig';
    if (ratio > 0.4) return 'Teilweise bewölkt';
    return 'Bewölkt';
  };

  const formatTime = (time: string | undefined) => {
    if (!time) return '—';
    // Time comes as HH:MM:SS, extract HH:MM
    return time.substring(0, 5);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sun className="w-4 h-4 text-yellow-500" />
            PV-Prognose
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Today's Forecast */}
        {todayForecast ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Heute</span>
              {getWeatherIcon(todayForecast.expected_kwh)}
            </div>
            <div className="text-3xl font-bold font-mono text-energy-export">
              {todayForecast.expected_kwh.toFixed(1)} kWh
            </div>
            <p className="text-xs text-muted-foreground">
              {getWeatherText(todayForecast.expected_kwh)}
            </p>
            
            {/* Sunrise/Sunset */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sunrise className="w-3 h-3" />
                {formatTime(todayForecast.sunrise)}
              </span>
              <span className="flex items-center gap-1">
                <Sunset className="w-3 h-3" />
                {formatTime(todayForecast.sunset)}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <Sun className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Keine Prognose verfügbar</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              Prognose abrufen
            </Button>
          </div>
        )}

        {/* Tomorrow Preview */}
        {tomorrowForecast && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Morgen</span>
              <div className="flex items-center gap-2">
                {getWeatherIcon(tomorrowForecast.expected_kwh)}
                <span className="font-mono font-medium">
                  {tomorrowForecast.expected_kwh.toFixed(1)} kWh
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Week Overview */}
        {weekForecasts.length > 2 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">7-Tage Vorschau</p>
            <div className="flex gap-1">
              {weekForecasts.slice(0, 7).map((forecast) => {
                const maxKwh = Math.max(...weekForecasts.map(f => f.expected_kwh), 1);
                const heightPercent = (forecast.expected_kwh / maxKwh) * 100;
                const date = parseISO(forecast.date);
                
                return (
                  <div key={forecast.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full h-12 bg-muted rounded-sm relative overflow-hidden">
                      <div 
                        className="absolute bottom-0 w-full bg-energy-export/70 rounded-sm transition-all"
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {format(date, 'EEE', { locale: de }).substring(0, 2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Last Update */}
        {todayForecast?.fetched_at && (
          <p className="text-[10px] text-muted-foreground text-right">
            Aktualisiert: {format(new Date(todayForecast.fetched_at), 'dd.MM. HH:mm', { locale: de })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
