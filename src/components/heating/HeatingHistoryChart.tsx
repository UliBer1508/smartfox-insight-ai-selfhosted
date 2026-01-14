import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3, Calendar, Flame } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Room } from '@/types/room';
import { getRoomAbbr } from '@/lib/roomUtils';
import { format, subDays, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';

interface DailyRoomData {
  date: string;
  displayDate: string;
  [roomName: string]: string | number;
}

interface HeatingHistoryChartProps {
  rooms: Room[];
}

const ROOM_COLORS = [
  '#ef4444', // Rot
  '#22c55e', // Grün
  '#3b82f6', // Blau
  '#f59e0b', // Amber/Orange
  '#a855f7', // Violett
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#f97316', // Deep Orange
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#facc15', // Gelb
];


// Custom Label für Balken mit Raumkürzel - Factory-Funktion für Closure
const createBarLabel = (roomName: string) => (props: any) => {
  const { x, y, width, height, value } = props;
  
  if (!value || value < 30 || height < 18 || width < 20) return null;
  
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="#ffffff"
      fontSize={10}
      fontWeight="bold"
      style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.7)' }}
    >
      {getRoomAbbr(roomName)}
    </text>
  );
};

export function HeatingHistoryChart({ rooms }: HeatingHistoryChartProps) {
  const [days, setDays] = useState(7);
  const [chartData, setChartData] = useState<DailyRoomData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totals, setTotals] = useState({ minutes: 0, energy: 0, cycles: 0 });
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  const loadHistoryData = useCallback(async () => {
    setIsLoading(true);
    try {
      const startDate = startOfDay(subDays(new Date(), days - 1));
      
      const { data, error } = await supabase
        .from('room_heating_logs')
        .select('room_id, timestamp, event_type, duration_minutes, energy_estimate_wh')
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: true })
        .limit(10000);

      if (error) throw error;

      // Create a map of room IDs to names
      const roomMap = new Map(rooms.map(r => [r.id, r.name]));

      // Initialize daily data for each day
      const dailyData: Record<string, Record<string, number>> = {};
      for (let i = 0; i < days; i++) {
        const date = format(subDays(new Date(), days - 1 - i), 'yyyy-MM-dd');
        dailyData[date] = {};
        rooms.forEach(room => {
          if (room.id) {
            dailyData[date][room.name] = 0;
          }
        });
      }

      // Aggregate heating minutes per room per day
      let totalMinutes = 0;
      let totalEnergy = 0;
      let totalCycles = 0;

      for (const log of data || []) {
        if (log.event_type === 'heating_stop' && log.duration_minutes != null && log.duration_minutes > 0 && log.timestamp) {
          const date = format(new Date(log.timestamp), 'yyyy-MM-dd');
          const roomName = roomMap.get(log.room_id);
          
          if (roomName && dailyData[date]) {
            dailyData[date][roomName] = (dailyData[date][roomName] || 0) + log.duration_minutes;
            totalMinutes += log.duration_minutes;
            totalEnergy += log.energy_estimate_wh || 0;
          }
        }
        if (log.event_type === 'heating_start') {
          totalCycles++;
        }
      }

      // Convert to chart format
      const formattedData: DailyRoomData[] = Object.entries(dailyData).map(([date, roomData]) => ({
        date,
        displayDate: format(new Date(date), 'EEE, dd.MM.', { locale: de }),
        ...roomData,
      }));

      setChartData(formattedData);
      setTotals({ minutes: totalMinutes, energy: totalEnergy, cycles: totalCycles });
    } catch (error) {
      console.error('Error loading heating history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days, rooms]);

  useEffect(() => {
    if (rooms.length > 0) {
      loadHistoryData();
    }
  }, [loadHistoryData, rooms.length]);

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)} Min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const hasData = chartData.some(d => 
    Object.entries(d).some(([key, val]) => key !== 'date' && key !== 'displayDate' && typeof val === 'number' && val > 0)
  );

  const activeRooms = rooms.filter(r => r.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <BarChart3 className="h-4 w-4" />
          Heizhistorie
        </CardTitle>
        <div className="flex gap-1">
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
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <Calendar className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm font-medium">Noch keine Heizhistorie vorhanden</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Die Heizzyklen werden automatisch erfasst, sobald sich der Heizstatus ändert.
            </p>
          </div>
        ) : (
          <>
            <div className="h-64 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="displayDate" 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}m`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length || !hoveredRoom) return null;
                      
                      const item = payload.find(p => p.dataKey === hoveredRoom);
                      if (!item || !item.value || (item.value as number) <= 0) return null;
                      
                      return (
                        <div className="bg-card border border-border rounded-lg px-3 py-2">
                          <p style={{ color: String(item.color) }} className="font-medium">{item.name}</p>
                          <p className="text-foreground">{formatMinutes(item.value as number)}</p>
                        </div>
                      );
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ fontSize: '11px' }}
                    iconSize={10}
                    formatter={(value: string) => getRoomAbbr(value)}
                  />
                {activeRooms.map((room, index) => (
                  <Bar
                    key={room.id}
                    dataKey={room.name}
                    stackId="a"
                    fill={ROOM_COLORS[index % ROOM_COLORS.length]}
                    radius={index === activeRooms.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    label={createBarLabel(room.name)}
                    onMouseOver={() => setHoveredRoom(room.name)}
                    onMouseOut={() => setHoveredRoom(null)}
                  />
                ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">
                  {formatMinutes(totals.minutes / days)}
                </div>
                <div className="text-xs text-muted-foreground">Ø Heizdauer/Tag</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500">
                  {(totals.energy / 1000).toFixed(1)} kWh
                </div>
                <div className="text-xs text-muted-foreground">Gesamt ({days} Tage)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold flex items-center justify-center gap-1">
                  <Flame className="h-5 w-5 text-red-500" />
                  {totals.cycles}
                </div>
                <div className="text-xs text-muted-foreground">Heizzyklen</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
