import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('room_heating_logs')
        .select('*')
        .gte('timestamp', `${today}T00:00:00`)
        .order('timestamp', { ascending: false });
      
      if (targetRoomId) {
        query = query.eq('room_id', targetRoomId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      setLogs(data || []);
      
      // Calculate stats per room
      const roomStats: Record<string, RoomHeatingStats> = {};
      
      for (const log of data || []) {
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
      const roomIds = [...new Set((data || []).map(l => l.room_id))];
      for (const roomId of roomIds) {
        const roomLogs = (data || []).filter(l => l.room_id === roomId);
        const starts = roomLogs.filter(l => l.event_type === 'heating_start');
        const stops = roomLogs.filter(l => l.event_type === 'heating_stop');
        
        // If more starts than stops, the last cycle is still running
        if (starts.length > stops.length && starts[0]?.timestamp) {
          const startTime = new Date(starts[0].timestamp).getTime();
          const runningMin = Math.round((Date.now() - startTime) / 60000);
          roomStats[roomId].todayDurationMin += runningMin;
        }
      }
      
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
