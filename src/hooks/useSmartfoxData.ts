import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';

export function useSmartfoxData() {
  const [currentReading, setCurrentReading] = useState<EnergyReading | null>(null);
  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<number>(60);

  // Load polling interval from database
  useEffect(() => {
    const loadPollingInterval = async () => {
      const { data } = await supabase
        .from('data_retention_settings')
        .select('polling_interval_seconds')
        .limit(1)
        .single();
      
      if (data?.polling_interval_seconds) {
        setPollingInterval(data.polling_interval_seconds);
      }
    };
    loadPollingInterval();
  }, []);

  // Check if data is fresh (3x polling interval)
  const checkConnectionStatus = useCallback((reading: EnergyReading | null) => {
    if (!reading?.timestamp) {
      setIsConnected(false);
      return;
    }
    
    const readingTime = new Date(reading.timestamp).getTime();
    const now = Date.now();
    const timeout = pollingInterval * 3 * 1000;
    
    setIsConnected(now - readingTime < timeout);
  }, [pollingInterval]);

  // Load total count of readings
  const loadTotalCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('energy_readings')
      .select('*', { count: 'exact', head: true });
    
    if (!error && count !== null) {
      setTotalCount(count);
    }
  }, []);

  // Load recent readings on mount
  const loadReadings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('energy_readings')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      if (data) {
        setReadings(data as EnergyReading[]);
        if (data.length > 0) {
          const latest = data[0] as EnergyReading;
          setCurrentReading(latest);
          checkConnectionStatus(latest);
        }
      }
      setLastError(null);
    } catch (error) {
      console.error('Error loading readings:', error);
      setLastError(error instanceof Error ? error.message : 'Fehler beim Laden');
      setIsConnected(false);
    }
  }, [checkConnectionStatus]);

  // Refresh data manually
  const refresh = useCallback(() => {
    loadReadings();
  }, [loadReadings]);

  // Load data on mount
  useEffect(() => {
    loadReadings();
    loadTotalCount();
  }, [loadReadings, loadTotalCount]);

  // Check connection status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      checkConnectionStatus(currentReading);
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [currentReading, checkConnectionStatus]);

  // Realtime subscription for new readings
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
          setTotalCount(prev => prev + 1);
          checkConnectionStatus(newReading);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [checkConnectionStatus]);

  return {
    currentReading,
    readings,
    totalCount,
    isConnected,
    lastError,
    refresh,
  };
}
