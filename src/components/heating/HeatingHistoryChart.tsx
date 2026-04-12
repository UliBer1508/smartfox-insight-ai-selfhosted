import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { Room } from '@/types/room';

const ROOM_COLORS = [
  '#ef4444', '#22c55e', '#3b82f6', '#f59e0b', 
  '#a855f7', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#6366f1', '#14b8a6', '#facc15'
];

interface HeatingHistoryChartProps {
  rooms: Room[];
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  [roomName: string]: number | string;
}

export function HeatingHistoryChart({ rooms }: HeatingHistoryChartProps) {
  const [days, setDays] = useState(7);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [roomNames, setRoomNames] = useState<string[]>([]);
  const [totalEnergy, setTotalEnergy] = useState(0);
  const [activeBar, setActiveBar] = useState<{name: string; value: number; color: string} | null>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        // Rufe RPC-Funktion auf
        const { data, error } = await supabase.rpc('get_heating_history', {
          days_back: days
        });

        if (error) {
          console.error('RPC error:', error);
          throw error;
        }

        console.log('Heating history data:', data);

        // Erstelle leere Tage
        const dateMap: Record<string, Record<string, number>> = {};
        for (let i = 0; i < days; i++) {
          const d = subDays(new Date(), days - 1 - i);
          const dateStr = format(d, 'yyyy-MM-dd');
          dateMap[dateStr] = {};
        }

        // Sammle Raumnamen und Gesamtverbrauch
        const roomTotals: Record<string, number> = {};
        let total = 0;
        
        for (const row of data || []) {
          const dateStr = row.local_date;
          if (dateMap[dateStr]) {
            const energyKwh = (row.total_energy_wh || 0) / 1000;
            dateMap[dateStr][row.room_name] = energyKwh;
            roomTotals[row.room_name] = (roomTotals[row.room_name] || 0) + energyKwh;
            total += energyKwh;
          }
        }

        // Sortiere Räume nach Gesamtverbrauch (höchster zuerst)
        const sortedRoomNames = Object.entries(roomTotals)
          .sort(([, a], [, b]) => b - a)
          .map(([name]) => name);

        // Konvertiere zu Chart-Format
        const chartRows: ChartDataPoint[] = Object.entries(dateMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dateStr, roomData]) => ({
            date: dateStr,
            displayDate: format(new Date(dateStr), 'EEE dd.MM.', { locale: de }),
            ...roomData
          }));

        setChartData(chartRows);
        setRoomNames(sortedRoomNames);
        setTotalEnergy(total);
      } catch (err) {
        console.error('Error loading heating history:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [days]);

  const hasData = chartData.some(d => 
    Object.values(d).some(v => typeof v === 'number' && v > 0)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle className="flex items-center gap-2 text-base whitespace-nowrap">
              <BarChart3 className="h-4 w-4 shrink-0" />
              Heizhistorie
            </CardTitle>
            {hasData && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                ({totalEnergy.toFixed(1)} kWh)
              </span>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {[7, 14, 30].map((d) => (
              <Button
                key={d}
                variant={days === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDays(d)}
                className="h-7 px-2 text-xs"
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <Calendar className="h-12 w-12 mb-4 opacity-50" />
            <p>Keine Heizhistorie vorhanden</p>
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="displayDate" 
                  tick={{ fontSize: 10 }} 
                  className="text-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 10 }} 
                  label={{ 
                    value: 'kWh', 
                    angle: -90, 
                    position: 'insideLeft', 
                    fontSize: 10,
                    className: 'fill-muted-foreground'
                  }}
                  className="text-muted-foreground"
                />
                <Tooltip 
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
                  content={({ active }) => {
                    if (!active || !activeBar || activeBar.value <= 0) return null;
                    return (
                      <div className="bg-card border border-border rounded-lg p-2 shadow-lg">
                        <div className="flex items-center gap-2 text-sm">
                          <div 
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                            style={{ backgroundColor: activeBar.color }}
                          />
                          <span className="font-medium text-foreground">{activeBar.name}</span>
                          <span className="text-muted-foreground">{activeBar.value.toFixed(2)} kWh</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '10px' }} 
                  iconSize={10}
                />
                {roomNames.map((name, i) => (
                  <Bar 
                    key={name} 
                    dataKey={name} 
                    fill={ROOM_COLORS[i % ROOM_COLORS.length]}
                    radius={[2, 2, 0, 0]}
                    onMouseEnter={(data) => {
                      if (data && data[name] !== undefined) {
                        setActiveBar({
                          name,
                          value: data[name] as number,
                          color: ROOM_COLORS[i % ROOM_COLORS.length]
                        });
                      }
                    }}
                    onMouseLeave={() => setActiveBar(null)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
