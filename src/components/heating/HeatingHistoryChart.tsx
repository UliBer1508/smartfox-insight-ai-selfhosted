import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3, Calendar, Flame, Zap, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Room, getEffectiveHeatingPower } from '@/types/room';
import { getRoomAbbr } from '@/lib/roomUtils';
import { subDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { getLocalDateString, formatLocalDate, getLocalMidnightDaysAgoISO } from '@/lib/dateUtils';

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

type ViewMode = 'energy' | 'efficiency';

// Custom Label für Balken mit Raumkürzel - Factory-Funktion für Closure
const createBarLabel = (roomName: string) => (props: any) => {
  const { x, y, width, height, value } = props;
  
  if (!value || value < 0.05 || height < 18 || width < 20) return null;
  
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
  const [viewMode, setViewMode] = useState<ViewMode>('energy');
  const [chartData, setChartData] = useState<DailyRoomData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totals, setTotals] = useState({ energy: 0, cycles: 0, avgDuration: 0 });
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  // Memoized maps to prevent infinite re-renders
  const roomAreaMap = useMemo(
    () => new Map(rooms.map(r => [r.name, r.floor_area_m2 || 0])),
    [rooms]
  );
  const roomMap = useMemo(
    () => new Map(rooms.map(r => [r.id, r.name])),
    [rooms]
  );
  const roomPowerMap = useMemo(
    () => new Map(rooms.map(r => [r.name, getEffectiveHeatingPower(r)])),
    [rooms]
  );

  const loadHistoryData = useCallback(async () => {
    if (rooms.length === 0) return;
    
    setIsLoading(true);
    try {
      // WICHTIG: Lokale Mitternacht für korrekte Zeitzonen-Behandlung
      const startTimestamp = getLocalMidnightDaysAgoISO(days - 1);
      
      // Nur plausible Daten laden (max 4h = 240 Min pro Zyklus)
      const { data, error } = await supabase
        .from('room_heating_logs')
        .select('room_id, timestamp, event_type, duration_minutes, energy_estimate_wh')
        .gte('timestamp', startTimestamp)
        .order('timestamp', { ascending: true })
        .limit(10000);

      if (error) throw error;

      // Initialize daily data for each day - LOKALE Zeitzone verwenden!
      const dailyDataEnergy: Record<string, Record<string, number>> = {};
      for (let i = 0; i < days; i++) {
        const date = getLocalDateString(subDays(new Date(), days - 1 - i));
        dailyDataEnergy[date] = {};
        rooms.forEach(room => {
          if (room.id) {
            dailyDataEnergy[date][room.name] = 0;
          }
        });
      }

      // Aggregate energy per room per day
      let totalEnergy = 0;
      let totalCycles = 0;
      let totalDuration = 0;
      let validCycles = 0;

      for (const log of data || []) {
        // Plausibilitätsfilter: Nur Einträge mit realistischer Dauer (<= 240 Min)
        if (
          log.event_type === 'heating_stop' && 
          log.duration_minutes != null && 
          log.duration_minutes > 0 && 
          log.duration_minutes <= 240 && // Max 4 Stunden
          log.timestamp
        ) {
          // WICHTIG: formatLocalDate() verwendet lokale Zeitzone!
          const date = formatLocalDate(log.timestamp);
          const roomName = roomMap.get(log.room_id);
          
          if (roomName && dailyDataEnergy[date]) {
            // Berechne Energie in kWh
            let energyKwh = 0;
            
            if (log.energy_estimate_wh && log.energy_estimate_wh > 0) {
              // Nutze gespeicherten Wert wenn vorhanden
              energyKwh = log.energy_estimate_wh / 1000;
            } else {
              // Berechne aus Dauer und Heizleistung
              const power = roomPowerMap.get(roomName) || 0;
              energyKwh = (power * log.duration_minutes) / 60 / 1000;
            }
            
            dailyDataEnergy[date][roomName] = (dailyDataEnergy[date][roomName] || 0) + energyKwh;
            totalEnergy += energyKwh;
            totalDuration += log.duration_minutes;
            validCycles++;
          }
        }
        if (log.event_type === 'heating_start') {
          totalCycles++;
        }
      }

      // Debug-Logging
      console.log('[HeatingHistoryChart] Loaded', data?.length, 'logs, dates:', Object.keys(dailyDataEnergy).sort());

      // Convert to chart format based on view mode - EXPLIZIT chronologisch sortiert!
      const formattedData: DailyRoomData[] = Object.entries(dailyDataEnergy)
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB)) // Chronologische Sortierung
        .map(([date, roomData]) => {
          const result: DailyRoomData = {
            date,
            displayDate: format(new Date(date), 'EEE, dd.MM.', { locale: de }),
          };
          
          Object.entries(roomData).forEach(([roomName, energyKwh]) => {
            if (viewMode === 'efficiency') {
              const area = roomAreaMap.get(roomName) || 1;
              result[roomName] = area > 0 ? Number((energyKwh / area).toFixed(3)) : 0;
            } else {
              result[roomName] = Number(energyKwh.toFixed(2));
            }
          });
          
          return result;
        });

      setChartData(formattedData);
      setTotals({ 
        energy: totalEnergy, 
        cycles: validCycles,
        avgDuration: validCycles > 0 ? totalDuration / validCycles : 0
      });
    } catch (error) {
      console.error('Error loading heating history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [days, viewMode, rooms, roomAreaMap, roomMap, roomPowerMap]);

  // Effect - lädt Daten wenn loadHistoryData sich ändert (enthält alle Dependencies)
  useEffect(() => {
    if (rooms.length > 0) {
      loadHistoryData();
    }
  }, [loadHistoryData, rooms.length]);

  // Realtime-Subscription für neue Heizungslog-Einträge
  useEffect(() => {
    const channel = supabase
      .channel('heating_logs_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_heating_logs' },
        (payload) => {
          console.log('[HeatingHistoryChart] New heating log received:', payload.new);
          // Daten neu laden wenn neuer Eintrag kommt
          loadHistoryData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadHistoryData]);

  const formatEnergy = (kwh: number) => {
    if (kwh < 1) return `${Math.round(kwh * 1000)} Wh`;
    return `${kwh.toFixed(1)} kWh`;
  };

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
        <div className="flex gap-2">
          <div className="flex gap-1 border rounded-md p-0.5">
            <Button
              variant={viewMode === 'energy' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('energy')}
              className="h-6 px-2 text-xs"
              title="Energieverbrauch in kWh"
            >
              <Zap className="h-3 w-3 mr-1" />
              kWh
            </Button>
            <Button
              variant={viewMode === 'efficiency' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('efficiency')}
              className="h-6 px-2 text-xs"
              title="Effizienz: kWh pro m²"
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              kWh/m²
            </Button>
          </div>
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
                    tickFormatter={(value) => viewMode === 'efficiency' ? `${value}` : `${value}`}
                    label={{ 
                      value: viewMode === 'efficiency' ? 'kWh/m²' : 'kWh', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' }
                    }}
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
                      
                      const room = rooms.find(r => r.name === hoveredRoom);
                      const area = room?.floor_area_m2;
                      
                      return (
                        <div className="bg-card border border-border rounded-lg px-3 py-2">
                          <p style={{ color: String(item.color) }} className="font-medium">{item.name}</p>
                          {viewMode === 'efficiency' ? (
                            <>
                              <p className="text-foreground">{(item.value as number).toFixed(3)} kWh/m²</p>
                              {area && <p className="text-xs text-muted-foreground">{area} m² Fläche</p>}
                            </>
                          ) : (
                            <p className="text-foreground">{formatEnergy(item.value as number)}</p>
                          )}
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
                <div className="text-2xl font-bold text-orange-500">
                  {formatEnergy(totals.energy)}
                </div>
                <div className="text-xs text-muted-foreground">Gesamt ({days} Tage)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">
                  {formatEnergy(totals.energy / days)}
                </div>
                <div className="text-xs text-muted-foreground">Ø pro Tag</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold flex items-center justify-center gap-1">
                  <Flame className="h-5 w-5 text-red-500" />
                  {totals.cycles}
                </div>
                <div className="text-xs text-muted-foreground">
                  Zyklen (Ø {formatMinutes(totals.avgDuration)})
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
