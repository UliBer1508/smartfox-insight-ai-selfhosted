import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Battery, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getViennaMinutesSinceMidnight, getViennaTimeString } from '@/lib/dateUtils';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { useBatteryHistory, BatteryHistoryPoint } from '@/hooks/useBatteryHistory';

interface ChartDataPoint {
  time: string;
  fullTime: string;  // Immer mit Datum für Slider/Details
  timestamp: Date;
  soc: number | null;
  charging: number | null;
  discharging: number | null;
}

type TimeRange = 'today' | '2days' | '3days';

const timeRangeLabels: Record<TimeRange, string> = {
  'today': 'Heute',
  '2days': '2 Tage',
  '3days': '3 Tage',
};

export function BatteryHistoryChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [sliderIndex, setSliderIndex] = useState<number>(0);
  const [stayAtLatest, setStayAtLatest] = useState(true);
  const daysBack = timeRange === 'today' ? 0 : timeRange === '2days' ? 1 : 2;
  const { data, isLoading, refresh } = useBatteryHistory(daysBack);

  const chartData = useMemo(() => {
    const today = new Date();
    const todayStr = today.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
    
    return data.map((point: BatteryHistoryPoint): ChartDataPoint => {
      const power = point.battery_power ?? 0;
      const pointDate = new Date(point.timestamp);
      const pointDateStr = pointDate.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
      const isToday = pointDateStr === todayStr;
      
      // Zeige Datum nur wenn nicht heute (für Chart X-Achse)
      const time = isToday
        ? pointDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
        : pointDate.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).replace(', ', ' ');
      
      // Immer mit Datum für Slider/Details
      const fullTime = pointDate.toLocaleString('de-DE', { 
        day: '2-digit', 
        month: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        timeZone: 'Europe/Berlin' 
      }).replace(', ', ' ');
      
      return {
        time,
        fullTime,
        timestamp: pointDate,
        soc: point.battery_soc,
        charging: power < 0 ? Math.abs(power) : null,      // negativ = laden, als positiv anzeigen
        discharging: power > 0 ? -power : null,             // positiv = entladen, als negativ anzeigen
      };
    });
  }, [data]);

  // Keep slider at latest when stayAtLatest is true or when data first loads
  useEffect(() => {
    if (chartData.length > 0 && stayAtLatest) {
      setSliderIndex(chartData.length - 1);
    }
  }, [chartData, stayAtLatest]);

  const formatPower = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)} kW`;
    }
    return `${Math.round(value)} W`;
  };

  // Relative Zeit berechnen (vor X Min/Std/Tagen)
  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 2) return null; // "gerade eben" = kein Zusatz nötig
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    const diffDays = Math.floor(diffHours / 24);
    return `vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
  };

  const isLatestSelected = stayAtLatest || sliderIndex === chartData.length - 1;

  const maxPower = useMemo(() => {
    let max = 0;
    for (const point of chartData) {
      if (point.charging && point.charging > max) max = point.charging;
      if (point.discharging && Math.abs(point.discharging) > max) max = Math.abs(point.discharging);
    }
    return Math.max(max, 1000); // Minimum 1kW scale
  }, [chartData]);

  // When stayAtLatest, always show the very latest point
  const selectedPoint = stayAtLatest && chartData.length > 0
    ? chartData[chartData.length - 1]
    : (chartData.length > 0 && sliderIndex >= 0 && sliderIndex < chartData.length 
        ? chartData[sliderIndex] 
        : null);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;

    const socPoint = payload.find((p: any) => p.dataKey === 'soc');
    const chargingPoint = payload.find((p: any) => p.dataKey === 'charging');
    const dischargingPoint = payload.find((p: any) => p.dataKey === 'discharging');

    const power = chargingPoint?.value ?? dischargingPoint?.value ?? 0;
    const isCharging = power > 0;

    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium text-foreground mb-2">{label} Uhr</p>
        {socPoint?.value != null && (
          <p className="text-sm text-muted-foreground">
            Ladezustand: <span className="font-mono text-foreground">{socPoint.value.toFixed(0)}%</span>
          </p>
        )}
        {power !== 0 && (
          <p className="text-sm text-muted-foreground">
            {isCharging ? 'Laden' : 'Entladen'}:{' '}
            <span className={`font-mono ${isCharging ? 'text-energy-export' : 'text-amber-500'}`}>
              {formatPower(Math.abs(power))}
            </span>
          </p>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Battery className="w-4 h-4 text-primary" />
              Batterie-Verlauf
            </CardTitle>
            <div className="flex items-center gap-1">
              {(['today', '2days', '3days'] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTimeRange(range)}
                >
                  {timeRangeLabels[range]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            Lade Daten...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Battery className="w-4 h-4 text-primary" />
              Batterie-Verlauf
            </CardTitle>
            <div className="flex items-center gap-1">
              {(['today', '2days', '3days'] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTimeRange(range)}
                >
                  {timeRangeLabels[range]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            Keine Batterie-Daten für {timeRangeLabels[timeRange]} verfügbar
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="w-4 h-4 text-primary" />
            Batterie-Verlauf
          </CardTitle>
          <div className="flex items-center gap-1">
              {(['today', '2days', '3days'] as TimeRange[]).map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTimeRange(range)}
                >
                  {timeRangeLabels[range]}
                </Button>
              ))}
            <Button variant="ghost" size="icon" onClick={refresh} className="h-7 w-7 ml-1">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="chargingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--energy-export))" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="hsl(var(--energy-export))" stopOpacity={0.2} />
                </linearGradient>
                <linearGradient id="dischargingGradient" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                yAxisId="soc"
                orientation="left"
                domain={[0, 100]}
                stroke="hsl(var(--primary))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
                width={45}
              />
              <YAxis
                yAxisId="power"
                orientation="right"
                domain={[-maxPower, maxPower]}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => {
                  if (value === 0) return '0';
                  return `${(value / 1000).toFixed(1)}kW`;
                }}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine yAxisId="power" y={0} stroke="hsl(var(--border))" />
              
              {/* Vertikale Referenzlinie für Slider-Position */}
              {selectedPoint?.time && (
                <ReferenceLine
                  yAxisId="soc"
                  x={selectedPoint.time}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
              )}
              
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="charging"
                fill="url(#chargingGradient)"
                stroke="hsl(var(--energy-export))"
                strokeWidth={1}
                connectNulls={false}
                name="Laden"
              />
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="discharging"
                fill="url(#dischargingGradient)"
                stroke="#f59e0b"
                strokeWidth={1}
                connectNulls={false}
                name="Entladen"
              />
              <Line
                yAxisId="soc"
                type="monotone"
                dataKey="soc"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="Ladezustand"
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Zeit-Slider - nur wenn genug Daten vorhanden */}
        {chartData.length > 1 && (
          <div className="mt-4 px-2">
            <Slider
              value={[Math.max(0, Math.min(sliderIndex, chartData.length - 1))]}
              max={chartData.length - 1}
              min={0}
              step={1}
              onValueChange={(value) => {
                const newIndex = value[0];
                setSliderIndex(newIndex);
                // Activate "stay at latest" mode when navigating to the end
                setStayAtLatest(newIndex >= chartData.length - 1);
              }}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span className="opacity-60">{chartData[0]?.fullTime}</span>
              <span className="font-medium text-foreground">
                {isLatestSelected ? 'Jetzt' : selectedPoint?.fullTime + ' Uhr'}
                {!isLatestSelected && selectedPoint && getRelativeTime(selectedPoint.timestamp) && (
                  <span className="text-muted-foreground ml-1">({getRelativeTime(selectedPoint.timestamp)})</span>
                )}
              </span>
              <span className="font-semibold text-primary">Jetzt</span>
            </div>
          </div>
        )}

        {/* Detail-Anzeige für ausgewählten Zeitpunkt */}
        {selectedPoint && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {isLatestSelected ? 'Jetzt' : `${selectedPoint.fullTime} Uhr`}
              {!isLatestSelected && getRelativeTime(selectedPoint.timestamp) && (
                <span className="text-muted-foreground font-normal ml-1">({getRelativeTime(selectedPoint.timestamp)})</span>
              )}
            </span>
            <div className="flex flex-wrap gap-4">
              {selectedPoint.soc != null && (
                <span>
                  SOC: <span className="font-mono font-medium">{selectedPoint.soc.toFixed(0)}%</span>
                </span>
              )}
              {selectedPoint.charging != null && selectedPoint.charging > 0 && (
                <span className="text-energy-export">
                  Laden: <span className="font-mono">{formatPower(selectedPoint.charging)}</span>
                </span>
              )}
              {selectedPoint.discharging != null && selectedPoint.discharging < 0 && (
                <span className="text-amber-500">
                  Entladen: <span className="font-mono">{formatPower(Math.abs(selectedPoint.discharging))}</span>
                </span>
              )}
              {!selectedPoint.charging && !selectedPoint.discharging && (
                <span className="text-muted-foreground">Standby</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
