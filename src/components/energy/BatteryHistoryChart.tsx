import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Battery, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useBatteryHistory, BatteryHistoryPoint } from '@/hooks/useBatteryHistory';

interface ChartDataPoint {
  time: string;
  timestamp: Date;
  soc: number | null;
  charging: number | null;
  discharging: number | null;
}

export function BatteryHistoryChart() {
  const { data, isLoading, refresh } = useBatteryHistory();

  const chartData = useMemo(() => {
    return data.map((point: BatteryHistoryPoint): ChartDataPoint => {
      const power = point.battery_power ?? 0;
      return {
        time: new Date(point.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }),
        timestamp: new Date(point.timestamp),
        soc: point.battery_soc,
        charging: power < 0 ? Math.abs(power) : null,      // negativ = laden, als positiv anzeigen
        discharging: power > 0 ? -power : null,             // positiv = entladen, als negativ anzeigen
      };
    });
  }, [data]);

  const formatPower = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)} kW`;
    }
    return `${Math.round(value)} W`;
  };

  const maxPower = useMemo(() => {
    let max = 0;
    for (const point of chartData) {
      if (point.charging && point.charging > max) max = point.charging;
      if (point.discharging && Math.abs(point.discharging) > max) max = Math.abs(point.discharging);
    }
    return Math.max(max, 1000); // Minimum 1kW scale
  }, [chartData]);

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
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="w-4 h-4 text-primary" />
            Batterie-Verlauf (24h)
          </CardTitle>
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
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="w-4 h-4 text-primary" />
            Batterie-Verlauf (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            Keine Batterie-Daten der letzten 24 Stunden verfügbar
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
            Batterie-Verlauf (24h)
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={refresh} className="h-8 w-8">
            <RefreshCw className="w-4 h-4" />
          </Button>
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
      </CardContent>
    </Card>
  );
}
