import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading, SmartfoxSettings, SmartfoxApiResponse, SmartfoxAllResponse } from '@/types/energy';
import { toast } from 'sonner';

interface FroniusResponse {
  Body?: {
    Data?: {
      Site?: {
        P_PV?: number;
        P_Akku?: number;
        P_Grid?: number;
        P_Load?: number;
      };
      Inverters?: {
        [key: string]: {
          SOC?: number;
        };
      };
    };
  };
}

export function useSmartfoxData(settings: SmartfoxSettings) {
  const [currentReading, setCurrentReading] = useState<EnergyReading | null>(null);
  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchFromFronius = useCallback(async (): Promise<number | null> => {
    if (!settings.fronius_ip || !settings.fronius_is_active) {
      return null;
    }

    try {
      const url = `http://${settings.fronius_ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
      console.log('Fetching from Fronius:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
      });
      
      if (!response.ok) {
        throw new Error(`Fronius HTTP ${response.status}`);
      }
      
      const data: FroniusResponse = await response.json();
      console.log('Fronius response:', data);
      
      // Get battery SOC from first inverter
      const inverters = data?.Body?.Data?.Inverters;
      if (inverters) {
        const firstInverter = Object.values(inverters)[0];
        if (firstInverter?.SOC !== undefined) {
          return firstInverter.SOC;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Fronius fetch error:', error);
      return null;
    }
  }, [settings.fronius_ip, settings.fronius_is_active]);

  const fetchFromSmartfox = useCallback(async (): Promise<SmartfoxApiResponse | null> => {
    try {
      // Use /all endpoint for extended data
      const basePath = settings.api_path === '/power' ? '/all' : settings.api_path;
      const url = `http://${settings.smartfox_ip}${basePath}`;
      console.log('Fetching from Smartfox:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: SmartfoxAllResponse = await response.json();
      setIsConnected(true);
      setLastError(null);
      
      console.log('Smartfox /all response:', data);
      
      // Calculate total power: positive = import, negative = export
      const powerIn = data.power_in ?? 0;
      const powerOut = data.power_out ?? 0;
      const powerTotal = powerIn - powerOut;
      
      // Sum PV power from all inverters (if array)
      const pvPowerTotal = Array.isArray(data.PvPower) 
        ? data.PvPower.reduce((sum, p) => sum + (p ?? 0), 0) 
        : 0;
      
      // Sum PV energy from all inverters (if array)
      const pvEnergyTotal = Array.isArray(data.PvEnergy) 
        ? data.PvEnergy.reduce((sum, e) => sum + (e ?? 0), 0) 
        : 0;
      
      return {
        power: powerTotal,
        energyIn: data.energy_in ?? 0,
        energyOut: data.energy_out ?? 0,
        pvPower: pvPowerTotal,
        pvEnergy: pvEnergyTotal,
        powerSmartfox: data.power_sf ?? 0,
        energySmartfox: data.energy_sf ?? 0,
        consumption: powerTotal + pvPowerTotal,
        relayStatus: data.outputs ?? [],
      };
    } catch (error) {
      console.error('Smartfox fetch error:', error);
      setIsConnected(false);
      setLastError(error instanceof Error ? error.message : 'Verbindungsfehler');
      return null;
    }
  }, [settings.smartfox_ip, settings.api_path]);

  const saveReading = useCallback(async (data: SmartfoxApiResponse, batterySoc: number | null) => {
    const reading: EnergyReading = {
      timestamp: new Date().toISOString(),
      power_io: data.power,
      energy_in: data.energyIn,
      energy_out: data.energyOut,
      pv_power: data.pvPower ?? null,
      consumption: data.consumption ?? null,
      battery_soc: batterySoc ?? undefined,
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
    // Fetch Smartfox and Fronius in parallel
    const [smartfoxData, batterySoc] = await Promise.all([
      fetchFromSmartfox(),
      fetchFromFronius(),
    ]);
    
    if (smartfoxData) {
      await saveReading(smartfoxData, batterySoc);
    }
  }, [fetchFromSmartfox, fetchFromFronius, saveReading]);

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
