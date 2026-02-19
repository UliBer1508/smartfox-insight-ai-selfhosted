import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BatteryHistoryPoint {
  timestamp: string;
  battery_soc: number | null;
  battery_power: number | null;
}

export function useBatteryHistory(daysBack: number = 0) {
  const [data, setData] = useState<BatteryHistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Sampling-Intervall basierend auf Zeitraum: heute=2min, 2 Tage=4min, 3 Tage=8min
  const samplingInterval = daysBack === 0 ? 2 * 60 * 1000 : daysBack === 1 ? 5 * 60 * 1000 : 10 * 60 * 1000;
  const queryLimit = daysBack === 0 ? 2000 : daysBack === 1 ? 5000 : 8000;

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      // Start from midnight of the selected day
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - daysBack);

      // Fetch in descending order to get newest data first (avoids 1000 row limit cutting off new data)
      const { data: readings, error } = await supabase
        .from('energy_readings')
        .select('timestamp, battery_soc, battery_power')
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: false })
        .limit(queryLimit);

      if (error) throw error;

      // Reverse to get chronological order (oldest first)
      const chronological = (readings || []).reverse();

      // Filter to entries with battery data
      const filtered = chronological.filter(
        (r) => r.battery_soc !== null || r.battery_power !== null
      );

      // Sample data to reduce points
      const sampled: BatteryHistoryPoint[] = [];
      let lastTime = 0;

      for (let i = 0; i < filtered.length; i++) {
        const reading = filtered[i];
        const time = new Date(reading.timestamp).getTime();
        const isLast = i === filtered.length - 1;
        
        // Immer den letzten Punkt einschließen für aktuelle Anzeige
        if (time - lastTime >= samplingInterval || sampled.length === 0 || isLast) {
          sampled.push({
            timestamp: reading.timestamp,
            battery_soc: reading.battery_soc,
            battery_power: reading.battery_power,
          });
          lastTime = time;
        }
      }

      setData(sampled);
    } catch (error) {
      console.error('Error loading battery history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [daysBack, samplingInterval]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Polling statt Realtime um DB-Last zu reduzieren
  useEffect(() => {
    const interval = setInterval(() => {
      loadHistory();
    }, 60000); // Alle 60 Sekunden

    return () => clearInterval(interval);
  }, [loadHistory]);

  return { data, isLoading, refresh: loadHistory };
}
