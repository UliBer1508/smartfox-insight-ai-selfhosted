import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EnergyReading } from '@/types/energy';

interface CalculatedEnergy {
  energyIn: number;  // kWh imported from grid today
  energyOut: number; // kWh exported to grid today
  pvEnergy: number;  // kWh produced by PV today
  isLoading: boolean;
  hasDataGaps: boolean;      // Gibt es signifikante Datenlücken?
  largestGapMinutes: number; // Größte Lücke in Minuten
  readingsCount: number;     // Anzahl geladener Readings für Debug
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
// WICHTIG: Für MEZ (UTC+1) ist 00:00 lokal = 23:00 UTC am Vortag
function getLocalMidnightISO(): string {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return localMidnight.toISOString();
}

// Pagination: Alle Readings in 1000er-Batches laden (Supabase-Limit umgehen)
async function fetchAllReadingsSince(startTimestamp: string): Promise<{ timestamp: string; power_io: number | null; pv_power: number | null; consumption: number | null }[]> {
  const PAGE_SIZE = 1000;
  let allReadings: { timestamp: string; power_io: number | null; pv_power: number | null; consumption: number | null }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('energy_readings')
      .select('timestamp, power_io, pv_power, consumption')
      .gte('timestamp', startTimestamp)
      .order('timestamp', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      allReadings = [...allReadings, ...data];
      offset += data.length;
      hasMore = data.length === PAGE_SIZE;
      console.log(`[EnergyCalc] Batch loaded: ${data.length} readings (total: ${allReadings.length})`);
    } else {
      hasMore = false;
    }
  }

  return allReadings;
}

// Max Lücke für Interpolation (6 Stunden)
const MAX_GAP_FOR_INTERPOLATION_HOURS = 6;

export function useEnergyCalculation(currentReadings: EnergyReading[]): CalculatedEnergy {
  const todayStr = useMemo(() => getTodayDateString(), []);
  // Verwende lokale Mitternacht für konsistente Queries
  const todayStart = useMemo(() => getLocalMidnightISO(), []);

  // Kein Realtime mehr - refetchInterval in useQuery reicht aus

  // Lade ALLE Readings von heute aus der Datenbank mit Pagination
  const { data: todayReadings, isLoading } = useQuery({
    queryKey: ['energy-readings-today', todayStr],
    queryFn: async () => {
      console.log(`[EnergyCalc] Fetching all readings since ${todayStart}`);
      const readings = await fetchAllReadingsSince(todayStart);
      
      if (readings.length > 0) {
        console.log(`[EnergyCalc] Total: ${readings.length} readings for ${todayStr}`);
        console.log(`[EnergyCalc] First: ${readings[0].timestamp}`);
        console.log(`[EnergyCalc] Last: ${readings[readings.length - 1].timestamp}`);
        
        // Debug: PV-Summe berechnen
        const pvSum = readings.reduce((sum, r) => sum + (r.pv_power ?? 0), 0);
        console.log(`[EnergyCalc] PV power sum: ${pvSum} W across all readings`);
      }
      
      return readings;
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    gcTime: 0,
  });

  return useMemo(() => {
    const readings = todayReadings || [];
    
    if (readings.length < 2) {
      return { energyIn: 0, energyOut: 0, pvEnergy: 0, isLoading, hasDataGaps: false, largestGapMinutes: 0, readingsCount: readings.length };
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

    const result = {
      energyIn: Math.round(energyIn * 100) / 100,
      energyOut: Math.round(energyOut * 100) / 100,
      pvEnergy: Math.round(pvEnergy * 100) / 100,
      isLoading,
      hasDataGaps,
      largestGapMinutes: Math.round(largestGapMinutes),
      readingsCount: readings.length
    };
    
    console.log(`[EnergyCalc] Result: ${result.pvEnergy} kWh PV, ${result.energyIn} kWh In, ${result.energyOut} kWh Out (${result.readingsCount} readings)`);
    
    return result;
  }, [todayReadings, isLoading]);
}
