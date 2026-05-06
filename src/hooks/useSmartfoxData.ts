import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';
import { toast } from 'sonner';

const COLLECTOR_TIMEOUT_MINUTES = 10;

export function useSmartfoxData() {
  const [currentReading, setCurrentReading] = useState<EnergyReading | null>(null);
  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<number>(60);
  const [offlineMinutes, setOfflineMinutes] = useState<number | null>(null);
  const hasShownTimeoutWarning = useRef(false);
  const currentReadingRef = useRef<EnergyReading | null>(null);
  const lastFetchRef = useRef<number>(0);

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
      setOfflineMinutes(null);
      return;
    }
    
    const readingTime = new Date(reading.timestamp).getTime();
    const now = Date.now();
    const timeout = pollingInterval * 3 * 1000;
    const minutesOffline = Math.floor((now - readingTime) / 60000);
    
    setOfflineMinutes(minutesOffline > 0 ? minutesOffline : null);
    setIsConnected(now - readingTime < timeout);
    
    // Warnung nach 10 Minuten ohne Daten
    if (minutesOffline >= COLLECTOR_TIMEOUT_MINUTES && !hasShownTimeoutWarning.current) {
      toast.warning(
        `Collector sendet seit ${minutesOffline} Minuten keine Daten!`,
        {
          description: 'Bitte prüfe, ob der Collector läuft und eine Verbindung zum Fronius-Gerät besteht.',
          duration: 10000,
        }
      );
      hasShownTimeoutWarning.current = true;
    }
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
        .select('id, timestamp, power_io, energy_in, energy_out, battery_soc, battery_power, pv_power, consumption')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      if (data) {
        setReadings(data as EnergyReading[]);
        if (data.length > 0) {
          const latest = data[0] as EnergyReading;
          setCurrentReading(latest);
          currentReadingRef.current = latest;
          checkConnectionStatus(latest);
        }
      }
      lastFetchRef.current = Date.now();
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

  // Single combined timer: stale-check every min(pollingInterval, 30)s,
  // DB fetch only when pollingInterval has elapsed since last fetch.
  useEffect(() => {
    const tickMs = Math.min(pollingInterval, 30) * 1000;
    const id = setInterval(() => {
      if (Date.now() - lastFetchRef.current >= pollingInterval * 1000) {
        loadReadings();
      } else {
        checkConnectionStatus(currentReadingRef.current);
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [pollingInterval, loadReadings, checkConnectionStatus]);

  return {
    currentReading,
    readings,
    totalCount,
    isConnected,
    lastError,
    offlineMinutes,
    refresh,
  };
}
