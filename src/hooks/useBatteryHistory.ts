import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BatteryHistoryPoint {
  timestamp: string;
  battery_soc: number | null;
  battery_power: number | null;
}

export function useBatteryHistory() {
  const [data, setData] = useState<BatteryHistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const { data: readings, error } = await supabase
        .from('energy_readings')
        .select('timestamp, battery_soc, battery_power')
        .gte('timestamp', twentyFourHoursAgo.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Filter to entries with battery data and sample every ~5 minutes
      const filtered = (readings || []).filter(
        (r) => r.battery_soc !== null || r.battery_power !== null
      );

      // Sample data to reduce points (max ~288 points for 24h at 5min intervals)
      const sampled: BatteryHistoryPoint[] = [];
      let lastTime = 0;
      const interval = 5 * 60 * 1000; // 5 minutes

      for (const reading of filtered) {
        const time = new Date(reading.timestamp).getTime();
        if (time - lastTime >= interval || sampled.length === 0) {
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
  }, []);

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

              // Remove points older than 24h
              const cutoff = Date.now() - 24 * 60 * 60 * 1000;
              const filtered = prev.filter(
                (p) => new Date(p.timestamp).getTime() > cutoff
              );

              const newPoint = {
                timestamp: newReading.timestamp,
                battery_soc: newReading.battery_soc,
                battery_power: newReading.battery_power,
              };

              // After 5+ minutes: add new point
              if (newTime - lastTime >= 5 * 60 * 1000) {
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
