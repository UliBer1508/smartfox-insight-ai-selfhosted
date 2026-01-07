import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, startOfDay, format } from 'date-fns';

export interface TemperatureSample {
  room_id: string;
  timestamp: string;
  temperature: number;
  is_heating: boolean;
  pv_power_w: number | null;
}

export interface ChartDataPoint {
  time: string;
  timestamp: Date;
  pvPower: number;
  [roomId: string]: number | string | Date; // Dynamic room temperatures
}

export interface RoomInfo {
  id: string;
  name: string;
  color: string;
}

const ROOM_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function useSolarGainChart(roomIds: string[], roomNames: Record<string, string>, days: number = 1) {
  return useQuery({
    queryKey: ['solar-gain-chart', roomIds, days],
    queryFn: async () => {
      const startDate = startOfDay(subDays(new Date(), days - 1));
      
      const { data: samples, error } = await supabase
        .from('room_temperature_samples')
        .select('*')
        .in('room_id', roomIds)
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Group samples by 15-minute intervals
      const intervalMs = 15 * 60 * 1000; // 15 minutes
      const groupedData = new Map<number, { temps: Record<string, number[]>, pvPowers: number[], heating: Record<string, boolean[]> }>();

      (samples || []).forEach((sample: TemperatureSample) => {
        const time = new Date(sample.timestamp).getTime();
        const intervalStart = Math.floor(time / intervalMs) * intervalMs;

        if (!groupedData.has(intervalStart)) {
          groupedData.set(intervalStart, { temps: {}, pvPowers: [], heating: {} });
        }

        const group = groupedData.get(intervalStart)!;
        
        if (!group.temps[sample.room_id]) {
          group.temps[sample.room_id] = [];
          group.heating[sample.room_id] = [];
        }
        
        group.temps[sample.room_id].push(sample.temperature);
        group.heating[sample.room_id].push(sample.is_heating);
        
        if (sample.pv_power_w !== null) {
          group.pvPowers.push(sample.pv_power_w);
        }
      });

      // Convert to chart data points
      const chartData: ChartDataPoint[] = [];
      const sortedIntervals = Array.from(groupedData.keys()).sort((a, b) => a - b);

      sortedIntervals.forEach(intervalStart => {
        const group = groupedData.get(intervalStart)!;
        const timestamp = new Date(intervalStart);
        
        const point: ChartDataPoint = {
          time: format(timestamp, 'HH:mm'),
          timestamp,
          pvPower: group.pvPowers.length > 0 
            ? Math.round(group.pvPowers.reduce((a, b) => a + b, 0) / group.pvPowers.length / 1000 * 10) / 10 
            : 0,
        };

        // Add average temperature for each room
        Object.entries(group.temps).forEach(([roomId, temps]) => {
          point[roomId] = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10;
        });

        chartData.push(point);
      });

      // Build room info with colors
      const roomInfo: RoomInfo[] = roomIds.map((id, index) => ({
        id,
        name: roomNames[id] || `Raum ${index + 1}`,
        color: ROOM_COLORS[index % ROOM_COLORS.length],
      }));

      return { chartData, roomInfo, sampleCount: samples?.length || 0 };
    },
    enabled: roomIds.length > 0,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}
