import React, { forwardRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { EnergyReading } from '@/types/energy';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface EnergyChartProps {
  readings: EnergyReading[];
  title?: string;
}

export const EnergyChart = forwardRef<HTMLDivElement, EnergyChartProps>(
  ({ readings, title = 'Leistungsverlauf' }, ref) => {
  const chartData = useMemo(() => {
    return [...readings]
      .reverse()
      .slice(-50)
      .map(reading => ({
        time: format(new Date(reading.timestamp), 'HH:mm', { locale: de }),
        power: reading.power_io,
        import: reading.power_io > 0 ? reading.power_io : 0,
        export: reading.power_io < 0 ? Math.abs(reading.power_io) : 0,
      }));
  }, [readings]);

  if (chartData.length === 0) {
    return (
      <Card ref={ref}>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          Keine Daten verfügbar
        </CardContent>
      </Card>
    );
  }

  return (
    <Card ref={ref}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="importGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--energy-import))" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(var(--energy-import))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="exportGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--energy-export))" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(var(--energy-export))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis 
              dataKey="time" 
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              tickFormatter={(value) => `${value}W`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              formatter={(value: number, name: string) => [
                `${value.toLocaleString('de-DE')} W`,
                name === 'import' ? 'Netzbezug' : name === 'export' ? 'Einspeisung' : 'Leistung'
              ]}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="import"
              stroke="hsl(var(--energy-import))"
              fill="url(#importGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="export"
              stroke="hsl(var(--energy-export))"
              fill="url(#exportGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
  }
);

EnergyChart.displayName = 'EnergyChart';
