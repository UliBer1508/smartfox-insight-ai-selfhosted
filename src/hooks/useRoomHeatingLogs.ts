import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getLocalMidnightISO } from '@/lib/dateUtils';

interface RoomHeatingLogEntry {
  id: string;
  room_id: string;
  timestamp: string | null;
  event_type: string;
  current_temp: number | null;
  target_temp: number | null;
  duration_minutes: number | null;
  energy_estimate_wh: number | null;
  pv_surplus_w: number | null;
  created_at: string | null;
}

interface RoomHeatingStats {
  todayCycles: number;
  todayDurationMin: number;
  todayEnergyWh: number;
  lastCycleStart?: string;
  lastCycleDurationMin?: number;
}

export function useRoomHeatingLogs(roomId?: string) {
  const [logs, setLogs] = useState<RoomHeatingLogEntry[]>([]);
  const [stats, setStats] = useState<Record<string, RoomHeatingStats>>({});
  const [isLoading, setIsLoading] = useState(false);

  const loadLogs = useCallback(async (targetRoomId?: string) => {
    setIsLoading(true);
    try {
      // Verwende lokale Mitternacht für korrekte Zeitzone
      const todayStart = getLocalMidnightISO();
      
      // Build query
      let query = supabase
        .from('room_heating_logs')
        .select('*')
        .gte('timestamp', todayStart)
        .order('timestamp', { ascending: false });
      
      if (targetRoomId) {
        query = query.eq('room_id', targetRoomId);
      }
      
      // Load logs and room power data in parallel
      const [logsResult, roomsResult] = await Promise.all([
        query,
        supabase.from('rooms').select('id, heating_power_w')
      ]);
      
      if (logsResult.error) throw logsResult.error;
      
      const data = logsResult.data || [];
      setLogs(data);
      
      // Create map for room heating power
      const roomPowerMap = new Map<string, number>(
        (roomsResult.data || []).map(r => [r.id, r.heating_power_w || 0])
      );
      
      // Calculate stats per room
      const roomStats: Record<string, RoomHeatingStats> = {};
      
      for (const log of data) {
        if (!roomStats[log.room_id]) {
          roomStats[log.room_id] = {
            todayCycles: 0,
            todayDurationMin: 0,
            todayEnergyWh: 0,
          };
        }
        
        if (log.event_type === 'heating_start') {
          roomStats[log.room_id].todayCycles++;
          if (!roomStats[log.room_id].lastCycleStart) {
            roomStats[log.room_id].lastCycleStart = log.timestamp || undefined;
          }
        }
        
        if (log.event_type === 'heating_stop') {
          roomStats[log.room_id].todayDurationMin += log.duration_minutes || 0;
          roomStats[log.room_id].todayEnergyWh += log.energy_estimate_wh || 0;
          if (!roomStats[log.room_id].lastCycleDurationMin) {
            roomStats[log.room_id].lastCycleDurationMin = log.duration_minutes || undefined;
          }
        }
      }

      // Calculate running cycles (starts without matching stops)
      const uniqueRoomIds = [...new Set(data.map(l => l.room_id))];
      for (const rid of uniqueRoomIds) {
        const roomLogs = data.filter(l => l.room_id === rid);
        const starts = roomLogs.filter(l => l.event_type === 'heating_start');
        const stops = roomLogs.filter(l => l.event_type === 'heating_stop');
        
        // If more starts than stops, the last cycle is still running
        if (starts.length > stops.length && starts[0]?.timestamp) {
          const startTime = new Date(starts[0].timestamp).getTime();
          const runningMin = Math.round((Date.now() - startTime) / 60000);
          const heatingPowerW = roomPowerMap.get(rid) || 0;
          
          // Ensure room stats exist
          if (!roomStats[rid]) {
            roomStats[rid] = {
              todayCycles: starts.length,
              todayDurationMin: 0,
              todayEnergyWh: 0,
            };
          }
          roomStats[rid].todayDurationMin += runningMin;
          
          // Estimate energy for running cycle: heating_power_w * (minutes / 60)
          if (heatingPowerW > 0) {
            roomStats[rid].todayEnergyWh += Math.round((runningMin / 60) * heatingPowerW);
          }
        }
      }
      
      console.log('[HeatingStats] Calculated stats:', roomStats);
      setStats(roomStats);
    } catch (error) {
      console.error('Error loading heating logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getRoomStats = useCallback((targetRoomId: string): RoomHeatingStats => {
    return stats[targetRoomId] || {
      todayCycles: 0,
      todayDurationMin: 0,
      todayEnergyWh: 0,
    };
  }, [stats]);

  useEffect(() => {
    loadLogs(roomId);
  }, [roomId, loadLogs]);

  return {
    logs,
    stats,
    isLoading,
    loadLogs,
    getRoomStats,
  };
}
