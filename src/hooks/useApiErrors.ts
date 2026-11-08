import { useCallback } from 'react';
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

// (08.11.2026) Kein Ausblenden alter Offline-Fehler mehr: auto-resolve-api-errors schließt sie jetzt nur,
// wenn das Gerät wirklich wieder gelesen wurde. Ein Thermostat, das seit Stunden fehlt, bleibt sichtbar.

// Transient/flapping types: a single Tuya device that doesn't answer in one
// sync cycle (and recovers in the next ~45-60s) should NOT immediately surface
// in the banner. These types are only shown once they persist (see below).
const TRANSIENT_TYPES = new Set(['connection_error', 'device_offline']);
// A transient error is considered a "real" persistent issue when either:
//  - the oldest open error for this device is older than this threshold, OR
//  - there are at least PERSIST_MIN_COUNT open entries for the same device.
const PERSIST_MIN_AGE_MS = 3 * 60 * 1000; // 3 minutes
const PERSIST_MIN_COUNT = 3;

// Group key for a transient error: prefer the physical device, fall back to room.
function deviceKey(e: ApiError): string {
  return e.device_id || e.room_id || `${e.source}:${e.error_type}`;
}

// Suppress flapping single-cycle outages: keep transient errors only for devices
// whose failures have persisted (old enough) or repeated (enough open entries).
function filterFlapping(list: ApiError[]): ApiError[] {
  const now = Date.now();
  const groups = new Map<string, ApiError[]>();
  for (const e of list) {
    if (!TRANSIENT_TYPES.has(e.error_type)) continue;
    const key = deviceKey(e);
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  const persistentKeys = new Set<string>();
  for (const [key, arr] of groups) {
    const oldest = Math.min(...arr.map((e) => new Date(e.created_at).getTime()));
    const isOldEnough = now - oldest > PERSIST_MIN_AGE_MS;
    const isRepeated = arr.length >= PERSIST_MIN_COUNT;
    if (isOldEnough || isRepeated) persistentKeys.add(key);
  }

  return list.filter(
    (e) => !TRANSIENT_TYPES.has(e.error_type) || persistentKeys.has(deviceKey(e)),
  );
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

      // Suppress flapping single-cycle outages; only show persistent/repeated ones.
      return filterFlapping(data as ApiError[]);
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

  // Polling via refetchInterval (bereits oben konfiguriert, kein Realtime nötig)

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
