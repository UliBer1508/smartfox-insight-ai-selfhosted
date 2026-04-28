import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useControlMode } from './useControlMode';

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
  const { mode } = useControlMode();

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
      if (mode === 'local') {
        // LOKAL-MODUS: Befehl in thermostat_commands schreiben
        // Queue mode command first (manual mode)
        await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_mode',
          value: 0,
          status: 'pending',
        });
        // Then queue temperature command
        const { error: insertError } = await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_temp',
          value: temperature,
          status: 'pending',
        });
        if (insertError) throw insertError;

        // Manual override setzen
        const overrideUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        await supabase.from('rooms').update({
          manual_override_until: overrideUntil,
          target_temp: temperature
        }).eq('id', roomId);

        console.log(`[useTuyaControl] Temperature command queued locally for room ${roomId}`);
        toast.success(`Temperatur ${temperature}°C → lokaler Service`);
        return true;
      }

      // CLOUD-MODUS: Edge Function aufrufen
      const { data, error } = await supabase.functions.invoke('tuya-control/set-temp', {
        body: { deviceId, temperature, roomId }
      });

      if (error) {
        console.error('[useTuyaControl] Edge function error:', error);
        throw new Error(error.message || 'Edge Function Fehler');
      }

      if (data?.fallback && data?.quotaExhausted) {
        toast.warning(data.error || 'Tuya API Quota erschöpft. Bitte manuell am Thermostat oder in der Tuya App einstellen.');
        return false;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Tuya API Fehler');
      }

      // Set manual override for 2 hours to protect from automation
      const overrideUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await supabase.from('rooms').update({
        manual_override_until: overrideUntil,
        target_temp: temperature
      }).eq('id', roomId);
      
      console.log(`[useTuyaControl] Temperature set via Cloud API, manual override until ${overrideUntil}`);

      toast.success(`Temperatur auf ${temperature}°C gesetzt`);
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
        // LOKAL-MODUS: Nur DB-Daten lesen, kein Cloud-Call
        const { data: rooms, error } = await supabase
          .from('rooms')
          .select('id, name, current_temp, target_temp, is_heating')
          .not('tuya_device_id', 'is', null);

        if (error) throw error;

        toast.success('Status aus Datenbank geladen (lokaler Modus)');
        return (rooms || []).map(r => ({
          roomId: r.id,
          name: r.name,
          currentTemp: r.current_temp ?? undefined,
          targetTemp: r.target_temp ?? undefined,
          isHeating: r.is_heating ?? undefined,
        }));
      }

      // CLOUD-MODUS: Edge Function aufrufen
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
