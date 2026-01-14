import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Room, RoomRecommendation } from '@/types/room';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/dateUtils';

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [recommendations, setRecommendations] = useState<RoomRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Lokales Update ohne Server-Reload für optimistische UI
  const updateRoomLocally = useCallback((roomId: string, updates: Partial<Room>) => {
    setRooms(prevRooms => 
      prevRooms.map(room => 
        room.id === roomId ? { ...room, ...updates } : room
      )
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
      // Cast the data properly to Room type including new Tuya fields
      setRooms(data as unknown as Room[]);
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

  const saveRoom = useCallback(async (room: Partial<Room>, skipReload = false) => {
    try {
      if (room.id) {
        // Optimistisches Update für sofortige UI-Reaktion
        if (skipReload) {
          updateRoomLocally(room.id, room);
        }
        
        const { error } = await supabase
          .from('rooms')
          .update({ ...room, updated_at: new Date().toISOString() })
          .eq('id', room.id);
        if (error) throw error;
        
        // Nur bei vollem Save neu laden
        if (!skipReload) {
          await loadRooms();
          toast.success('Raum gespeichert');
        }
      } else {
        const { error } = await supabase
          .from('rooms')
          .insert([room as any]);
        if (error) throw error;
        await loadRooms();
        toast.success('Raum gespeichert');
      }
    } catch (error) {
      console.error('Error saving room:', error);
      // Bei Fehler: State durch Neuladen korrigieren
      await loadRooms();
      toast.error('Fehler beim Speichern');
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
      // Delete existing recommendations for today
      await supabase
        .from('room_recommendations')
        .delete()
        .eq('date', today);

      // Insert new recommendations
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
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    return recommendations.find(rec => 
      rec.room_id === roomId && 
      rec.start_time <= currentTime && 
      rec.end_time > currentTime
    );
  }, [recommendations]);

  useEffect(() => {
    loadRooms();
    loadRecommendations();
  }, [loadRooms, loadRecommendations]);

  // Realtime subscription for rooms updates
  useEffect(() => {
    const channel = supabase
      .channel('rooms_realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms' },
        (payload) => {
          console.log('🔄 Room realtime update:', payload.new);
          const updatedRoom = payload.new as unknown as Room;
          setRooms(prevRooms => 
            prevRooms.map(room => 
              room.id === updatedRoom.id ? updatedRoom : room
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
