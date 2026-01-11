import { useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';

interface CalculatedEnergy {
  energyIn: number;  // kWh imported from grid today
  energyOut: number; // kWh exported to grid today
  pvEnergy: number;  // kWh produced by PV today
  isLoading: boolean;
  hasDataGaps: boolean;      // Gibt es signifikante Datenlücken?
  largestGapMinutes: number; // Größte Lücke in Minuten
}

// Stabiler Datumsstring für heute (lokale Zeit, ändert sich nur täglich)
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Lokale Mitternacht als ISO-String für konsistente DB-Queries
function getLocalMidnightISO(): string {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return localMidnight.toISOString();
}

// Max Lücke für Interpolation (6 Stunden)
const MAX_GAP_FOR_INTERPOLATION_HOURS = 6;

export function useEnergyCalculation(currentReadings: EnergyReading[]): CalculatedEnergy {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => getTodayDateString(), []);
  // Verwende lokale Mitternacht für konsistente Queries
  const todayStart = useMemo(() => getLocalMidnightISO(), []);

  // Realtime-Subscription: Bei neuen Readings Query invalidieren
  useEffect(() => {
    const channel = supabase
      .channel('energy-calc-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'energy_readings' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['energy-readings-today', todayStr] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, todayStr]);

  // Lade ALLE Readings von heute aus der Datenbank
  const { data: todayReadings, isLoading } = useQuery({
    queryKey: ['energy-readings-today', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('energy_readings')
        .select('timestamp, power_io, pv_power, consumption')
        .gte('timestamp', todayStart)
        .order('timestamp', { ascending: true })
        .limit(5000); // Explizites Limit für alle Tages-Readings (bei 30s Intervall: ~2880/Tag)
      
      if (error) throw error;
      console.log(`[EnergyCalc] Loaded ${data?.length || 0} readings for ${todayStr} (from ${todayStart})`);
      return data as EnergyReading[];
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  return useMemo(() => {
    const readings = todayReadings || [];
    
    if (readings.length < 2) {
      return { energyIn: 0, energyOut: 0, pvEnergy: 0, isLoading, hasDataGaps: false, largestGapMinutes: 0 };
    }

    let energyIn = 0;
    let energyOut = 0;
    let pvEnergy = 0;
    let largestGapMinutes = 0;
    let hasDataGaps = false;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      
      const hoursElapsed = (new Date(curr.timestamp).getTime() - 
                           new Date(prev.timestamp).getTime()) / (1000 * 60 * 60);
      
      const gapMinutes = hoursElapsed * 60;
      if (gapMinutes > largestGapMinutes) {
        largestGapMinutes = gapMinutes;
      }
      if (gapMinutes > 30) {
        hasDataGaps = true;
      }
      
      // Zu große Lücken (> 6h) ignorieren - vermutlich Tageswechsel oder größerer Ausfall
      if (hoursElapsed > MAX_GAP_FOR_INTERPOLATION_HOURS) continue;
      
      // Normale Berechnung für alle Lücken bis 6 Stunden (inkl. Interpolation)
      const avgPower = ((prev.power_io ?? 0) + (curr.power_io ?? 0)) / 2;
      
      if (avgPower > 0) {
        energyIn += (avgPower * hoursElapsed) / 1000;
      } else {
        energyOut += (Math.abs(avgPower) * hoursElapsed) / 1000;
      }
      
      const avgPvPower = ((prev.pv_power ?? 0) + (curr.pv_power ?? 0)) / 2;
      pvEnergy += (avgPvPower * hoursElapsed) / 1000;
    }

    return {
      energyIn: Math.round(energyIn * 100) / 100,
      energyOut: Math.round(energyOut * 100) / 100,
      pvEnergy: Math.round(pvEnergy * 100) / 100,
      isLoading,
      hasDataGaps,
      largestGapMinutes: Math.round(largestGapMinutes)
    };
  }, [todayReadings, isLoading]);
}
