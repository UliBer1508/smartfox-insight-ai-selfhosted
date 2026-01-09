import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, startOfMonth, startOfYear } from 'date-fns';
import { Room, getEffectiveHeatingPower } from '@/types/room';

export type Period = 'day' | 'month' | 'year';

interface PeriodStats {
  cycles: number;
  durationMin: number;
  energyWh: number;
  topConsumers: { roomId: string; roomName: string; energyWh: number }[];
}

interface HeatingConsumption {
  day: PeriodStats;
  month: PeriodStats;
  year: PeriodStats;
}

const emptyStats: PeriodStats = {
  cycles: 0,
  durationMin: 0,
  energyWh: 0,
  topConsumers: [],
};

// Hilfsfunktion: Überlappende Intervalle zusammenführen
function calculateMergedDuration(intervals: { start: Date; end: Date }[]): number {
  if (intervals.length === 0) return 0;
  
  // Sortiere nach Startzeit
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  
  const merged: { start: Date; end: Date }[] = [];
  let current = { ...sorted[0] };
  
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start.getTime() <= current.end.getTime()) {
      // Überlappung - erweitere aktuelles Intervall
      current.end = new Date(Math.max(current.end.getTime(), sorted[i].end.getTime()));
    } else {
      // Keine Überlappung - speichere und starte neu
      merged.push(current);
      current = { ...sorted[i] };
    }
  }
  merged.push(current);
  
  // Summiere Dauer aller zusammengeführten Intervalle
  return merged.reduce((total, interval) => {
    return total + Math.round((interval.end.getTime() - interval.start.getTime()) / 60000);
  }, 0);
}

export function useHeatingConsumption(rooms: Room[]) {
  const [consumption, setConsumption] = useState<HeatingConsumption>({
    day: emptyStats,
    month: emptyStats,
    year: emptyStats,
  });
  const [isLoading, setIsLoading] = useState(true);

  const roomMap = useMemo(() => {
    const map = new Map<string, Room>();
    rooms.forEach(r => {
      if (r.id) map.set(r.id, r);
    });
    return map;
  }, [rooms]);

  const loadConsumption = useCallback(async () => {
    if (rooms.length === 0) return;

    setIsLoading(true);
    try {
      const now = new Date();
      const yearStart = startOfYear(now);

      // Fetch all logs from start of year (includes month and day)
      const { data: logs, error } = await supabase
        .from('room_heating_logs')
        .select('*')
        .gte('timestamp', yearStart.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      const dayStart = startOfDay(now);
      const monthStart = startOfMonth(now);

      // Aggregate for each period
      const aggregateForPeriod = (periodStart: Date): PeriodStats => {
        const periodLogs = (logs || []).filter(
          log => new Date(log.timestamp || '') >= periodStart
        );

        const roomStats = new Map<string, { cycles: number; durationMin: number; energyWh: number }>();
        
        // Sammle alle Heizintervalle für überlappende Berechnung
        const allIntervals: { start: Date; end: Date }[] = [];

      periodLogs.forEach(log => {
        const roomId = log.room_id;
        if (!roomStats.has(roomId)) {
          roomStats.set(roomId, { cycles: 0, durationMin: 0, energyWh: 0 });
        }
        const stats = roomStats.get(roomId)!;

        if (log.event_type === 'heating_start') {
          stats.cycles += 1;
        }
        if (log.event_type === 'heating_stop' && log.duration_minutes && log.timestamp) {
          const stopTime = new Date(log.timestamp);
          const startTime = new Date(stopTime.getTime() - (log.duration_minutes * 60000));
          
          // Prüfe ob Heizzyklus vor periodStart begonnen hat
          if (startTime < periodStart) {
            // Berechne nur den Anteil innerhalb der Periode
            const totalDuration = log.duration_minutes;
            const durationInPeriod = Math.max(0, (stopTime.getTime() - periodStart.getTime()) / 60000);
            const ratio = durationInPeriod / totalDuration;
            
            // Nur proportionaler Anteil der Energie
            stats.durationMin += Math.round(durationInPeriod);
            stats.energyWh += Math.round((log.energy_estimate_wh || 0) * ratio);
            
            // Interval nur für den Teil innerhalb der Periode
            allIntervals.push({ start: periodStart, end: stopTime });
          } else {
            // Kompletter Zyklus in der Periode
            stats.durationMin += log.duration_minutes;
            stats.energyWh += log.energy_estimate_wh || 0;
            allIntervals.push({ start: startTime, end: stopTime });
          }
        }
      });

        // Add energy for currently heating rooms
        rooms.forEach(room => {
          if (room.is_heating && room.id) {
            const power = getEffectiveHeatingPower(room);
            const lastStart = periodLogs
              .filter(l => l.room_id === room.id && l.event_type === 'heating_start')
              .pop();

            if (lastStart?.timestamp) {
              const startTime = new Date(lastStart.timestamp);
              const durationMin = Math.round((now.getTime() - startTime.getTime()) / 60000);
              const energyWh = Math.round((power * durationMin) / 60);

              if (!roomStats.has(room.id)) {
                roomStats.set(room.id, { cycles: 0, durationMin: 0, energyWh: 0 });
              }
              const stats = roomStats.get(room.id)!;
              stats.durationMin += durationMin;
              stats.energyWh += energyWh;
              
              // Füge laufendes Intervall hinzu
              allIntervals.push({ start: startTime, end: now });
            }
          }
        });

        // Berechne nicht-überlappende Gesamtdauer
        const mergedDuration = calculateMergedDuration(allIntervals);

        // Calculate totals and top consumers
        let totalCycles = 0;
        let totalEnergy = 0;
        const consumers: { roomId: string; roomName: string; energyWh: number }[] = [];

        roomStats.forEach((stats, roomId) => {
          totalCycles += stats.cycles;
          totalEnergy += stats.energyWh;

          const room = roomMap.get(roomId);
          if (room && stats.energyWh > 0) {
            consumers.push({
              roomId,
              roomName: room.name,
              energyWh: stats.energyWh,
            });
          }
        });

        consumers.sort((a, b) => b.energyWh - a.energyWh);

        return {
          cycles: totalCycles,
          durationMin: mergedDuration, // Überlappungsfreie Dauer
          energyWh: totalEnergy,
          topConsumers: consumers.slice(0, 3),
        };
      };

      setConsumption({
        day: aggregateForPeriod(dayStart),
        month: aggregateForPeriod(monthStart),
        year: aggregateForPeriod(yearStart),
      });
    } catch (err) {
      console.error('Error loading heating consumption:', err);
    } finally {
      setIsLoading(false);
    }
  }, [rooms, roomMap]);

  useEffect(() => {
    loadConsumption();
  }, [loadConsumption]);

  return { consumption, isLoading, refresh: loadConsumption };
}
