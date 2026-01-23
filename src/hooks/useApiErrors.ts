import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ApiError {
  id: string;
  created_at: string;
  source: string;
  room_id: string | null;
  room_name: string | null;
  error_type: string;
  error_message: string | null;
  error_code: string | null;
  device_id: string | null;
  resolved_at: string | null;
  is_acknowledged: boolean;
  retry_count: number;
}

export function useApiErrors() {
  const queryClient = useQueryClient();

  // Fetch active (unresolved) errors
  const { data: errors, isLoading, refetch } = useQuery({
    queryKey: ['api-errors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_errors')
        .select('*')
        .is('resolved_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ApiError[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Acknowledge an error (hides it temporarily)
  const acknowledgeMutation = useMutation({
    mutationFn: async (errorId: string) => {
      const { error } = await supabase
        .from('api_errors')
        .update({ is_acknowledged: true })
        .eq('id', errorId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-errors'] });
    },
  });

  // Mark errors as resolved (used after successful API call)
  const resolveErrors = useCallback(async (roomId?: string, deviceId?: string) => {
    let query = supabase
      .from('api_errors')
      .update({ resolved_at: new Date().toISOString() })
      .is('resolved_at', null);

    if (roomId) {
      query = query.eq('room_id', roomId);
    } else if (deviceId) {
      query = query.eq('device_id', deviceId);
    }

    await query;
    queryClient.invalidateQueries({ queryKey: ['api-errors'] });
  }, [queryClient]);

  // Get errors for a specific room
  const getErrorsForRoom = useCallback((roomId: string): ApiError[] => {
    return (errors || []).filter(e => e.room_id === roomId && !e.is_acknowledged);
  }, [errors]);

  // Check if a room has active errors
  const hasRoomError = useCallback((roomId: string): boolean => {
    return getErrorsForRoom(roomId).length > 0;
  }, [getErrorsForRoom]);

  // Get total active error count
  const activeErrorCount = (errors || []).filter(e => !e.is_acknowledged).length;

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('api-errors-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'api_errors',
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  return {
    errors: errors || [],
    isLoading,
    refetch,
    acknowledgeError: acknowledgeMutation.mutate,
    resolveErrors,
    getErrorsForRoom,
    hasRoomError,
    activeErrorCount,
    hasErrors: activeErrorCount > 0,
  };
}
