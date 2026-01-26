import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TuyaDevice {
  id: string;
  name: string;
  category: string;
  product_name: string;
  online: boolean;
}

export interface ThermostatStatus {
  currentTemp: number;
  targetTemp: number;
  isHeating: boolean;
}

export interface RoomStatus {
  roomId: string;
  name: string;
  currentTemp?: number;
  targetTemp?: number;
  isHeating?: boolean;
  error?: string;
}

export function useTuyaControl() {
  const [devices, setDevices] = useState<TuyaDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('tuya-control', {
        method: 'GET',
        body: undefined,
      });

      // For GET requests, we need to use fetch directly
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tuya-control/devices`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch devices');
      }

      setDevices(result.devices || []);
      return result.devices || [];
    } catch (error) {
      console.error('Error fetching Tuya devices:', error);
      toast.error('Fehler beim Laden der Tuya-Geräte');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getStatus = useCallback(async (deviceId?: string): Promise<ThermostatStatus | RoomStatus[] | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('tuya-control/status', {
        body: { deviceId },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      return deviceId ? data.status : data.results;
    } catch (error) {
      console.error('Error getting thermostat status:', error);
      toast.error('Fehler beim Abrufen des Thermostat-Status');
      return null;
    }
  }, []);

  const setTemperature = useCallback(async (deviceId: string, temperature: number, roomId?: string): Promise<boolean> => {
    if (!roomId) {
      toast.error('Room ID fehlt');
      return false;
    }

    try {
      // Befehl in Command-Queue schreiben (wird vom lokalen Collector verarbeitet)
      const { error: cmdError } = await supabase.from('thermostat_commands').insert({
        room_id: roomId,
        command: 'set_temp',
        value: temperature,
        status: 'pending'
      });

      if (cmdError) throw cmdError;

      // Set manual override for 2 hours to protect from automation
      const overrideUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await supabase.from('rooms').update({
        manual_override_until: overrideUntil,
        target_temp: temperature // Optimistic update
      }).eq('id', roomId);
      
      console.log(`[useTuyaControl] Command queued, manual override set until ${overrideUntil} for room ${roomId}`);

      toast.success(`Temperatur auf ${temperature}°C gesetzt`);
      return true;
    } catch (error) {
      console.error('Error setting temperature:', error);
      toast.error('Fehler beim Setzen der Temperatur');
      return false;
    }
  }, []);

  const syncAllStatus = useCallback(async (): Promise<RoomStatus[]> => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('tuya-control/sync-all', {
        body: {},
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success('Thermostat-Status synchronisiert');
      return data.results || [];
    } catch (error) {
      console.error('Error syncing thermostats:', error);
      toast.error('Fehler beim Synchronisieren');
      return [];
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    devices,
    isLoading,
    isSyncing,
    fetchDevices,
    getStatus,
    setTemperature,
    syncAllStatus,
  };
}
