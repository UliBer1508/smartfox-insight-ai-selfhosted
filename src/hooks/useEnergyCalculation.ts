import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';

interface CalculatedEnergy {
  energyIn: number;  // kWh imported from grid today
  energyOut: number; // kWh exported to grid today
  pvEnergy: number;  // kWh produced by PV today
  isLoading: boolean;
}

export function useEnergyCalculation(currentReadings: EnergyReading[]): CalculatedEnergy {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Lade ALLE Readings von heute aus der Datenbank
  const { data: todayReadings, isLoading } = useQuery({
    queryKey: ['energy-readings-today', today.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('energy_readings')
        .select('timestamp, power_io, pv_power, consumption')
        .gte('timestamp', today.toISOString())
        .order('timestamp', { ascending: true });
      
      if (error) throw error;
      return data as EnergyReading[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return useMemo(() => {
    const readings = todayReadings || [];
    
    if (readings.length < 2) {
      return { energyIn: 0, energyOut: 0, pvEnergy: 0, isLoading };
    }

    let energyIn = 0;
    let energyOut = 0;
    let pvEnergy = 0;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      
      const hoursElapsed = (new Date(curr.timestamp).getTime() - 
                           new Date(prev.timestamp).getTime()) / (1000 * 60 * 60);
      
      // Größere Lücken tolerieren (bis 30 min)
      if (hoursElapsed > 0.5) continue;
      
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
      isLoading
    };
  }, [todayReadings, isLoading]);
}
