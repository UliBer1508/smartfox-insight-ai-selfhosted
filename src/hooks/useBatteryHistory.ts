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
  const samplingInterval = daysBack === 0 ? 2 * 60 * 1000 : daysBack === 1 ? 4 * 60 * 1000 : 8 * 60 * 1000;

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      // Start from midnight of the selected day
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - daysBack);

      const { data: readings, error } = await supabase
        .from('energy_readings')
        .select('timestamp, battery_soc, battery_power')
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Filter to entries with battery data
      const filtered = (readings || []).filter(
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

  // Subscribe to new readings
  useEffect(() => {
    const channel = supabase
      .channel('battery_history_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'energy_readings' },
        (payload) => {
          const newReading = payload.new as {
            timestamp: string;
            battery_soc: number | null;
            battery_power: number | null;
          };

          if (newReading.battery_soc !== null || newReading.battery_power !== null) {
            setData((prev) => {
              const lastPoint = prev[prev.length - 1];
              const lastTime = lastPoint ? new Date(lastPoint.timestamp).getTime() : 0;
              const newTime = new Date(newReading.timestamp).getTime();

              // Remove points before midnight of start date
              const startDate = new Date();
              startDate.setHours(0, 0, 0, 0);
              startDate.setDate(startDate.getDate() - daysBack);
              const cutoff = startDate.getTime();
              const filtered = prev.filter(
                (p) => new Date(p.timestamp).getTime() >= cutoff
              );

              const newPoint = {
                timestamp: newReading.timestamp,
                battery_soc: newReading.battery_soc,
                battery_power: newReading.battery_power,
              };

              // After sampling interval: add new point
              if (newTime - lastTime >= samplingInterval) {
                return [...filtered, newPoint];
              }
              
              // Under 5 minutes: update last point for immediate display
              if (filtered.length > 0) {
                return [...filtered.slice(0, -1), newPoint];
              }
              
              return [newPoint];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { data, isLoading, refresh: loadHistory };
}
