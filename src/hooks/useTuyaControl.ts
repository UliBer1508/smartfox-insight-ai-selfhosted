import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTuyaControlMode } from './useTuyaControlMode';

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
  const { mode } = useTuyaControlMode();

  const fetchDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tuya-control/devices`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch devices');
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
      if (mode === 'local') {
        // Read directly from rooms table
        const { data, error } = await supabase
          .from('rooms')
          .select('id, name, current_temp, target_temp, is_heating')
          .not('tuya_device_id', 'is', null);

        if (error) throw error;

        if (deviceId) {
          const room = data?.find(r => r.id === deviceId);
          if (!room) return null;
          return {
            currentTemp: room.current_temp ?? 0,
            targetTemp: room.target_temp ?? 0,
            isHeating: room.is_heating ?? false,
          };
        }

        return (data || []).map(r => ({
          roomId: r.id,
          name: r.name,
          currentTemp: r.current_temp ?? undefined,
          targetTemp: r.target_temp ?? undefined,
          isHeating: r.is_heating ?? undefined,
        }));
      }

      // Cloud mode
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
  }, [mode]);

  const setTemperature = useCallback(async (deviceId: string, temperature: number, roomId?: string): Promise<boolean> => {
    if (!roomId) {
      toast.error('Room ID fehlt');
      return false;
    }

    try {
      if (mode === 'local') {
        // Insert command into thermostat_commands queue
        const { error } = await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_temp',
          value: temperature,
          status: 'pending',
        });
        if (error) throw error;
      } else {
        // Cloud mode: call Edge Function
        const { data, error } = await supabase.functions.invoke('tuya-control/set-temp', {
          body: { deviceId, temperature, roomId }
        });
        if (error) throw new Error(error.message || 'Edge Function Fehler');
        if (!data?.success) throw new Error(data?.error || 'Tuya API Fehler');
      }

      // Set manual override for 2 hours
      const overrideUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await supabase.from('rooms').update({
        manual_override_until: overrideUntil,
        target_temp: temperature
      }).eq('id', roomId);

      console.log(`[useTuyaControl] Temperature set (${mode}), manual override until ${overrideUntil}`);
      toast.success(mode === 'local'
        ? `Temperatur-Befehl gesendet (${temperature}°C)`
        : `Temperatur auf ${temperature}°C gesetzt`
      );
      return true;
    } catch (error) {
      console.error('Error setting temperature:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Fehler: ${errorMsg}`);
      return false;
    }
  }, [mode]);

  const syncAllStatus = useCallback(async (): Promise<RoomStatus[]> => {
    setIsSyncing(true);
    try {
      if (mode === 'local') {
        // Read directly from rooms table
        const { data, error } = await supabase
          .from('rooms')
          .select('id, name, current_temp, target_temp, is_heating')
          .not('tuya_device_id', 'is', null);

        if (error) throw error;

        toast.success('Thermostat-Status aus Datenbank gelesen');
        return (data || []).map(r => ({
          roomId: r.id,
          name: r.name,
          currentTemp: r.current_temp ?? undefined,
          targetTemp: r.target_temp ?? undefined,
          isHeating: r.is_heating ?? undefined,
        }));
      }

      // Cloud mode
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
  }, [mode]);

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
