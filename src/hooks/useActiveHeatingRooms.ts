import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getLocalMidnightISO } from '@/lib/dateUtils';
import { Room, getEffectiveHeatingPower } from '@/types/room';

export interface ActiveHeatingRoom {
  room_id: string;
  room_name: string;
  power: number;
  duration_min: number;
  start_time: string;
}

interface ActiveHeatingRoomsResult {
  activeRooms: ActiveHeatingRoom[];
  totalHeatingPower: number;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Hook to identify currently heating rooms based on room_heating_logs
 * This is more reliable than the is_heating flag in the rooms table
 * because it's based on actual heating_start/heating_stop events.
 */
export function useActiveHeatingRooms(): ActiveHeatingRoomsResult {
  const [activeRooms, setActiveRooms] = useState<ActiveHeatingRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadActiveRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      const todayStart = getLocalMidnightISO();
      
      // Load today's heating logs and room data in parallel
      const [logsResult, roomsResult] = await Promise.all([
        supabase
          .from('room_heating_logs')
          .select('room_id, event_type, timestamp')
          .gte('timestamp', todayStart)
          .in('event_type', ['heating_start', 'heating_stop'])
          .order('timestamp', { ascending: false }),
        supabase
          .from('rooms')
          .select('id, name, heating_power_w, calculated_power_w, power_calculation_confidence, power_samples, floor_area_m2')
      ]);

      if (logsResult.error) throw logsResult.error;
      if (roomsResult.error) throw roomsResult.error;

      const logs = logsResult.data || [];
      const rooms = roomsResult.data || [];

      // Create room lookup map
      const roomMap = new Map(rooms.map(r => [r.id, r as Room]));

      // Find rooms that have more starts than stops (currently heating)
      const roomEventCounts = new Map<string, { starts: number; stops: number; lastStart: string | null }>();
      
      for (const log of logs) {
        if (!roomEventCounts.has(log.room_id)) {
          roomEventCounts.set(log.room_id, { starts: 0, stops: 0, lastStart: null });
        }
        const counts = roomEventCounts.get(log.room_id)!;
        
        if (log.event_type === 'heating_start') {
          counts.starts++;
          if (!counts.lastStart && log.timestamp) {
            counts.lastStart = log.timestamp;
          }
        } else if (log.event_type === 'heating_stop') {
          counts.stops++;
        }
      }

      // Identify active rooms (more starts than stops)
      const now = Date.now();
      const activeHeatingRooms: ActiveHeatingRoom[] = [];

      for (const [roomId, counts] of roomEventCounts) {
        if (counts.starts > counts.stops && counts.lastStart) {
          const room = roomMap.get(roomId);
          if (room) {
            const startTime = new Date(counts.lastStart).getTime();
            const durationMin = Math.round((now - startTime) / 60000);
            
            activeHeatingRooms.push({
              room_id: roomId,
              room_name: room.name,
              power: getEffectiveHeatingPower(room),
              duration_min: durationMin,
              start_time: counts.lastStart
            });
          }
        }
      }

      // Sort by power (highest first)
      activeHeatingRooms.sort((a, b) => b.power - a.power);
      
      console.log('[ActiveHeatingRooms] Found active rooms:', activeHeatingRooms.length, activeHeatingRooms);
      setActiveRooms(activeHeatingRooms);
    } catch (error) {
      console.error('[ActiveHeatingRooms] Error loading active rooms:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActiveRooms();

    // Subscribe to room_heating_logs changes for real-time updates
    const channel = supabase
      .channel('active-heating-rooms')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'room_heating_logs' 
      }, () => {
        console.log('[ActiveHeatingRooms] Realtime update received');
        loadActiveRooms();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadActiveRooms]);

  const totalHeatingPower = activeRooms.reduce((sum, room) => sum + room.power, 0);

  return {
    activeRooms,
    totalHeatingPower,
    isLoading,
    refetch: loadActiveRooms
  };
}
