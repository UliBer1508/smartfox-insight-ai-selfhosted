import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading, SmartfoxSettings, SmartfoxApiResponse } from '@/types/energy';
import { toast } from 'sonner';

export function useSmartfoxData(settings: SmartfoxSettings) {
  const [currentReading, setCurrentReading] = useState<EnergyReading | null>(null);
  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchFromSmartfox = useCallback(async (): Promise<SmartfoxApiResponse | null> => {
    try {
      const url = `http://${settings.smartfox_ip}${settings.api_path}`;
      console.log('Fetching from Smartfox:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setIsConnected(true);
      setLastError(null);
      
      // Smartfox API response mapping
      return {
        power: data.power_io ?? data.power ?? data.Power ?? 0,
        energyIn: data.energy_in ?? data.energyIn ?? data.EnergyIn ?? 0,
        energyOut: data.energy_out ?? data.energyOut ?? data.EnergyOut ?? 0,
      };
    } catch (error) {
      console.error('Smartfox fetch error:', error);
      setIsConnected(false);
      setLastError(error instanceof Error ? error.message : 'Verbindungsfehler');
      return null;
    }
  }, [settings.smartfox_ip, settings.api_path]);

  const saveReading = useCallback(async (data: SmartfoxApiResponse) => {
    const reading: EnergyReading = {
      timestamp: new Date().toISOString(),
      power_io: data.power,
      energy_in: data.energyIn,
      energy_out: data.energyOut,
    };

    try {
      const { data: savedData, error } = await supabase
        .from('energy_readings')
        .insert(reading)
        .select()
        .single();

      if (error) throw error;
      
      setCurrentReading(savedData as EnergyReading);
      setReadings(prev => [savedData as EnergyReading, ...prev.slice(0, 99)]);
      
      return savedData;
    } catch (error) {
      console.error('Error saving reading:', error);
      return null;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    const data = await fetchFromSmartfox();
    if (data) {
      await saveReading(data);
    }
  }, [fetchFromSmartfox, saveReading]);

  const startPolling = useCallback(() => {
    if (!settings.is_active || intervalRef.current) return;
    
    setIsPolling(true);
    pollOnce();
    
    intervalRef.current = setInterval(() => {
      pollOnce();
    }, settings.polling_interval * 1000);
    
    toast.success('Datenerfassung gestartet');
  }, [settings.is_active, settings.polling_interval, pollOnce]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
    toast.info('Datenerfassung gestoppt');
  }, []);

  const testConnection = useCallback(async () => {
    const data = await fetchFromSmartfox();
    if (data) {
      toast.success('Verbindung erfolgreich!');
      return true;
    } else {
      toast.error('Verbindung fehlgeschlagen');
      return false;
    }
  }, [fetchFromSmartfox]);

  // Load recent readings on mount
  useEffect(() => {
    const loadReadings = async () => {
      const { data, error } = await supabase
        .from('energy_readings')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (!error && data) {
        setReadings(data as EnergyReading[]);
        if (data.length > 0) {
          setCurrentReading(data[0] as EnergyReading);
        }
      }
    };

    loadReadings();
  }, []);

  // Auto-start polling if active
  useEffect(() => {
    if (settings.is_active && !isPolling) {
      startPolling();
    } else if (!settings.is_active && isPolling) {
      stopPolling();
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [settings.is_active]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('energy_readings_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'energy_readings' },
        (payload) => {
          const newReading = payload.new as EnergyReading;
          setCurrentReading(newReading);
          setReadings(prev => [newReading, ...prev.slice(0, 99)]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    currentReading,
    readings,
    isConnected,
    isPolling,
    lastError,
    startPolling,
    stopPolling,
    testConnection,
    pollOnce,
  };
}
