import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Room, RoomRecommendation } from '@/types/room';
import { toast } from 'sonner';
import { getLocalDateString, getViennaTimeString } from '@/lib/dateUtils';

const sortRooms = (rooms: Room[]): Room[] =>
  [...rooms].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name));

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [recommendations, setRecommendations] = useState<RoomRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const updateRoomLocally = useCallback((roomId: string, updates: Partial<Room>) => {
    setRooms(prevRooms => 
      sortRooms(prevRooms.map(room => 
        room.id === roomId ? { ...room, ...updates } : room
      ))
    );
  }, []);

  const loadRooms = useCallback(async () => {
    console.log('🔄 Loading rooms...');
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .order('priority', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true });

      console.log('📊 Rooms response:', { data, error, count: data?.length });

      if (error) throw error;
      setRooms(sortRooms(data as unknown as Room[]));
      console.log('✅ Rooms set:', data?.length);
    } catch (error) {
      console.error('❌ Error loading rooms:', error);
      toast.error('Fehler beim Laden der Räume');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    const today = getLocalDateString();
    try {
      const { data, error } = await supabase
        .from('room_recommendations')
        .select('*')
        .eq('date', today)
        .order('start_time', { ascending: true });

      if (error) throw error;
      setRecommendations(data as RoomRecommendation[]);
    } catch (error) {
      console.error('Error loading room recommendations:', error);
    }
  }, []);

  const saveRoom = useCallback(async (room: Partial<Room>, skipReload = false): Promise<boolean> => {
    try {
      if (room.id) {
        if (skipReload) {
          updateRoomLocally(room.id, room);
        }
        
        const { error } = await supabase
          .from('rooms')
          .update({ ...room, updated_at: new Date().toISOString() })
          .eq('id', room.id);
        
        if (error) {
          // Unique-Verstoß
          if (error.code === '23505' && error.message?.includes('priority')) {
            toast.error(`Priorität ${room.priority} ist bereits vergeben`);
            return false;
          }
          // Check-Constraint
          if (error.code === '23514') {
            toast.error('Priorität muss zwischen 1 und 12 liegen');
            return false;
          }
          throw error;
        }
        
        if (!skipReload) {
          await loadRooms();
          toast.success('Raum gespeichert');
        }
      } else {
        const { error } = await supabase
          .from('rooms')
          .insert([room as any]);
        if (error) {
          if (error.code === '23505' && error.message?.includes('priority')) {
            toast.error(`Priorität ${room.priority} ist bereits vergeben`);
            return false;
          }
          throw error;
        }
        await loadRooms();
        toast.success('Raum gespeichert');
      }
      return true;
    } catch (error) {
      console.error('Error saving room:', error);
      await loadRooms();
      toast.error('Fehler beim Speichern');
      return false;
    }
  }, [loadRooms, updateRoomLocally]);

  const deleteRoom = useCallback(async (roomId: string) => {
    try {
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', roomId);
      if (error) throw error;
      await loadRooms();
      toast.success('Raum gelöscht');
    } catch (error) {
      console.error('Error deleting room:', error);
      toast.error('Fehler beim Löschen');
    }
  }, [loadRooms]);

  const saveRecommendations = useCallback(async (newRecommendations: RoomRecommendation[]) => {
    const today = getLocalDateString();
    try {
      await supabase
        .from('room_recommendations')
        .delete()
        .eq('date', today);

      if (newRecommendations.length > 0) {
        const { error } = await supabase
          .from('room_recommendations')
          .insert(newRecommendations);
        if (error) throw error;
      }
      
      await loadRecommendations();
    } catch (error) {
      console.error('Error saving room recommendations:', error);
      toast.error('Fehler beim Speichern der Empfehlungen');
    }
  }, [loadRecommendations]);

  const getCurrentRecommendation = useCallback((roomId: string): RoomRecommendation | undefined => {
    const currentTime = getViennaTimeString();
    
    return recommendations.find(rec => 
      rec.room_id === roomId && 
      rec.start_time.substring(0, 5) <= currentTime && 
      rec.end_time.substring(0, 5) > currentTime
    );
  }, [recommendations]);

  useEffect(() => {
    loadRooms();
    loadRecommendations();
  }, [loadRooms, loadRecommendations]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadRooms();
    }, 30000);

    return () => clearInterval(interval);
  }, [loadRooms]);

  return {
    rooms,
    recommendations,
    isLoading,
    loadRooms,
    loadRecommendations,
    saveRoom,
    deleteRoom,
    saveRecommendations,
    getCurrentRecommendation,
    updateRoomLocally
  };
}
