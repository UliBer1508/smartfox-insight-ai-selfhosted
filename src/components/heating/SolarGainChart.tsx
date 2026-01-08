import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sun, Thermometer, TrendingUp } from 'lucide-react';
import { useSolarGainChart } from '@/hooks/useSolarGainChart';
import { getRoomAbbr } from '@/lib/roomUtils';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { Room } from '@/types/room';

interface SolarGainChartProps {
  rooms: Room[];
}

type TimeRange = '24h' | '48h' | '7d';

export function SolarGainChart({ rooms }: SolarGainChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  
  const days = timeRange === '24h' ? 1 : timeRange === '48h' ? 2 : 7;
  
  const roomIds = rooms.map(r => r.id);
  const roomNames = Object.fromEntries(rooms.map(r => [r.id, r.name]));
  
  const { data, isLoading } = useSolarGainChart(roomIds, roomNames, days);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sun className="h-5 w-5 text-yellow-500" />
            Temperatur vs. PV-Produktion
          </CardTitle>
          <div className="flex gap-1">
            {(['24h', '48h', '7d'] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Lade Daten...
          </div>
        ) : !data || data.sampleCount === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <TrendingUp className="h-12 w-12 opacity-50" />
            <div className="text-center">
              <p className="font-medium">Noch keine Temperaturdaten vorhanden</p>
              <p className="text-sm mt-1">
                Die Daten werden automatisch bei jedem Thermostat-Sync erfasst.
              </p>
              <p className="text-sm">
                Nach 24h sind genug Daten für eine aussagekräftige Darstellung vorhanden.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pvGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(45, 93%, 47%)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(45, 93%, 47%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                  className="text-muted-foreground"
                />
                <YAxis 
                  yAxisId="temp"
                  orientation="left"
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}°`}
                  className="text-muted-foreground"
                />
                <YAxis 
                  yAxisId="pv"
                  orientation="right"
                  domain={[0, 'dataMax + 2']}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}kW`}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length || !hoveredKey) return null;
                    
                    const item = payload.find(p => p.dataKey === hoveredKey);
                    if (!item || item.value === null || item.value === undefined) return null;
                    
                    const isPV = item.dataKey === 'pvPower';
                    const displayValue = isPV ? `${item.value} kW` : `${item.value}°C`;
                    const displayName = isPV ? 'PV-Produktion' : item.name;
                    
                    return (
                      <div className="bg-card border border-border rounded-lg px-3 py-2">
                        <p style={{ color: String(item.color) }} className="font-medium">{displayName}</p>
                        <p className="text-foreground">{displayValue}</p>
                      </div>
                    );
                  }}
                />
                <Legend 
                  formatter={(value: string) => getRoomAbbr(value)}
                  wrapperStyle={{ fontSize: '11px' }}
                />
                
                {/* PV Production Area */}
                <Area
                  yAxisId="pv"
                  type="monotone"
                  dataKey="pvPower"
                  name="PV"
                  stroke="hsl(45, 93%, 47%)"
                  fill="url(#pvGradient)"
                  strokeWidth={2}
                  onMouseEnter={() => setHoveredKey('pvPower')}
                  onMouseLeave={() => setHoveredKey(null)}
                />
                
                {/* Temperature Lines per Room */}
                {data.roomInfo.map((room) => (
                  <Line
                    key={room.id}
                    yAxisId="temp"
                    type="monotone"
                    dataKey={room.id}
                    name={room.name}
                    stroke={room.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    activeDot={{ r: 6, strokeWidth: 2 }}
                    onMouseEnter={() => setHoveredKey(room.id)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        
        {data && data.sampleCount > 0 && (
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Thermometer className="h-3 w-3" />
              {data.sampleCount} Messpunkte
            </span>
            <span className="flex items-center gap-1">
              <Sun className="h-3 w-3 text-yellow-500" />
              Gelbe Fläche = PV-Produktion
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
