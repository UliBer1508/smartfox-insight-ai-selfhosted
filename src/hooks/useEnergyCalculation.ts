import { useMemo } from 'react';
import { EnergyReading } from '@/types/energy';

interface CalculatedEnergy {
  energyIn: number;  // kWh imported from grid today
  energyOut: number; // kWh exported to grid today
  pvEnergy: number;  // kWh produced by PV today
}

export function useEnergyCalculation(readings: EnergyReading[]): CalculatedEnergy {
  return useMemo(() => {
    if (!readings || readings.length < 2) {
      return { energyIn: 0, energyOut: 0, pvEnergy: 0 };
    }

    // Filter readings from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayReadings = readings
      .filter(r => new Date(r.timestamp) >= today)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (todayReadings.length < 2) {
      return { energyIn: 0, energyOut: 0, pvEnergy: 0 };
    }

    let energyIn = 0;  // Grid import (positive power_io)
    let energyOut = 0; // Grid export (negative power_io)
    let pvEnergy = 0;  // PV production

    for (let i = 1; i < todayReadings.length; i++) {
      const prev = todayReadings[i - 1];
      const curr = todayReadings[i];
      
      const prevTime = new Date(prev.timestamp).getTime();
      const currTime = new Date(curr.timestamp).getTime();
      const hoursElapsed = (currTime - prevTime) / (1000 * 60 * 60);
      
      // Skip if time gap is too large (> 10 min) - likely missing data
      if (hoursElapsed > 0.167) continue;
      
      // Average power during interval
      const avgPower = (prev.power_io + curr.power_io) / 2;
      
      // power_io > 0 = importing from grid, < 0 = exporting to grid
      if (avgPower > 0) {
        energyIn += (avgPower * hoursElapsed) / 1000; // W*h -> kWh
      } else {
        energyOut += (Math.abs(avgPower) * hoursElapsed) / 1000;
      }
      
      // PV energy calculation
      const avgPvPower = ((prev.pv_power ?? 0) + (curr.pv_power ?? 0)) / 2;
      pvEnergy += (avgPvPower * hoursElapsed) / 1000;
    }

    return {
      energyIn: Math.round(energyIn * 100) / 100,
      energyOut: Math.round(energyOut * 100) / 100,
      pvEnergy: Math.round(pvEnergy * 100) / 100
    };
  }, [readings]);
}
