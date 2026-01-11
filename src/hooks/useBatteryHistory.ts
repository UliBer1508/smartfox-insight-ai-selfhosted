import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BatteryHistoryPoint {
  timestamp: string;
  battery_soc: number | null;
  battery_power: number | null;
}

export function useBatteryHistory(hours: number = 24) {
  const [data, setData] = useState<BatteryHistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Sampling-Intervall basierend auf Zeitraum: 12h=2.5min, 24h=5min, 48h=10min
  const samplingInterval = hours <= 12 ? 2.5 * 60 * 1000 : hours <= 24 ? 5 * 60 * 1000 : 10 * 60 * 1000;

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const hoursAgo = new Date();
      hoursAgo.setHours(hoursAgo.getHours() - hours);

      const { data: readings, error } = await supabase
        .from('energy_readings')
        .select('timestamp, battery_soc, battery_power')
        .gte('timestamp', hoursAgo.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Filter to entries with battery data
      const filtered = (readings || []).filter(
        (r) => r.battery_soc !== null || r.battery_power !== null
      );

      // Sample data to reduce points (max ~288 points)
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
  }, [hours, samplingInterval]);

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

              // Remove points older than selected hours
              const cutoff = Date.now() - hours * 60 * 60 * 1000;
              const filtered = prev.filter(
                (p) => new Date(p.timestamp).getTime() > cutoff
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
