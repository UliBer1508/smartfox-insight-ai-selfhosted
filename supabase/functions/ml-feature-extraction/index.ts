import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RoomHeatingLog {
  room_id: string;
  event_type: string;
  timestamp: string;
  duration_minutes: number | null;
  energy_estimate_wh: number | null;
  current_temp: number | null;
  target_temp: number | null;
  pv_surplus_w: number | null;
}

interface TemperatureSample {
  room_id: string;
  timestamp: string;
  temperature: number;
  is_heating: boolean;
  pv_power_w: number | null;
}

interface EnergyReading {
  timestamp: string;
  pv_power: number | null;
  consumption: number | null;
  battery_soc: number | null;
  power_io: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { room_id, date } = await req.json();
    const targetDate = date || new Date().toISOString().split('T')[0];

    console.log(`Extracting ML features for room ${room_id || 'all'} on ${targetDate}`);

    // Lade alle Räume wenn keine room_id angegeben
    const roomQuery = supabase.from('rooms').select('*');
    if (room_id) {
      roomQuery.eq('id', room_id);
    }
    const { data: rooms, error: roomsError } = await roomQuery;
    if (roomsError) throw roomsError;

    const results = [];

    for (const room of rooms || []) {
      // Lade Daten der letzten 7 Tage für bessere Feature-Berechnung
      const startDate = new Date(targetDate);
      startDate.setDate(startDate.getDate() - 7);

      // Parallele Datenabfragen
      const [heatingLogsResult, tempSamplesResult, energyResult] = await Promise.all([
        supabase
          .from('room_heating_logs')
          .select('*')
          .eq('room_id', room.id)
          .gte('timestamp', startDate.toISOString())
          .order('timestamp', { ascending: true }),
        supabase
          .from('room_temperature_samples')
          .select('*')
          .eq('room_id', room.id)
          .gte('timestamp', startDate.toISOString())
          .order('timestamp', { ascending: true }),
        supabase
          .from('energy_readings')
          .select('*')
          .gte('timestamp', startDate.toISOString())
          .order('timestamp', { ascending: true })
      ]);

      const heatingLogs = (heatingLogsResult.data || []) as RoomHeatingLog[];
      const tempSamples = (tempSamplesResult.data || []) as TemperatureSample[];
      const energyReadings = (energyResult.data || []) as EnergyReading[];

      // Feature-Berechnung
      const features = calculateFeatures(room, heatingLogs, tempSamples, energyReadings);

      // Speichere Features
      const { error: upsertError } = await supabase
        .from('room_ml_features')
        .upsert({
          room_id: room.id,
          date: targetDate,
          ...features,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'room_id,date'
        });

      if (upsertError) {
        console.error(`Error saving features for room ${room.name}:`, upsertError);
      } else {
        console.log(`Features saved for room ${room.name}:`, features);
        results.push({ room: room.name, features });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Feature extraction error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function calculateFeatures(
  room: any,
  heatingLogs: RoomHeatingLog[],
  tempSamples: TemperatureSample[],
  energyReadings: EnergyReading[]
) {
  // 1. Heat Loss Rate (Grad-Verlust pro Stunde ohne Heizung)
  const heatLossRate = calculateHeatLossRate(tempSamples);

  // 2. Heating Rate (Grad-Gewinn pro Stunde bei Heizung)
  const heatingRate = calculateHeatingRate(tempSamples);

  // 3. Energie pro Grad
  const energyPerDegree = calculateEnergyPerDegree(heatingLogs, tempSamples);

  // 4. Solar Gain Factor
  const solarGainFactor = calculateSolarGainFactor(tempSamples, energyReadings);

  // 5. Heizverhalten
  const heatingBehavior = calculateHeatingBehavior(heatingLogs);

  // 6. Effizienz-Metriken
  const efficiency = calculateEfficiencyMetrics(heatingLogs, energyReadings);

  // 7. Confidence basierend auf Feature-Qualität (nicht nur Datenmenge)
  const sampleCount = tempSamples.length + heatingLogs.length;
  
  // Confidence-Komponenten: welche Features konnten berechnet werden?
  let confidenceScore = 0;
  let maxScore = 0;
  
  // Kernfeatures: jeweils 20% Gewicht
  maxScore += 20;
  if (heatLossRate !== null) confidenceScore += 20;
  
  maxScore += 20;
  if (heatingRate !== null) confidenceScore += 20;
  
  maxScore += 15;
  if (energyPerDegree !== null) confidenceScore += 15;
  
  maxScore += 10;
  if (solarGainFactor.factor !== null) confidenceScore += 10;
  
  // Heizverhalten: 15% Gewicht
  maxScore += 15;
  if (heatingBehavior.avgDuration !== null && heatingBehavior.avgCycles !== null) {
    confidenceScore += 15;
  } else if (heatingBehavior.avgDuration !== null || heatingBehavior.avgCycles !== null) {
    confidenceScore += 8;
  }
  
  // Effizienz-Metriken: 10% Gewicht
  maxScore += 10;
  if (efficiency.pvRatio !== null) confidenceScore += 10;
  
  // Sample-Bonus: bis zu 10% extra für viele Datenpunkte
  maxScore += 10;
  const heatingCycles = heatingLogs.filter(l => 
    l.event_type === 'heating_stop' || l.event_type === 'solar_limit_stop'
  ).length;
  if (heatingCycles >= 20) {
    confidenceScore += 10;
  } else if (heatingCycles >= 10) {
    confidenceScore += 7;
  } else if (heatingCycles >= 5) {
    confidenceScore += 4;
  }
  
  const confidence = Math.round((confidenceScore / maxScore) * 100) / 100;

  const preheatDuration = heatingRate && heatingRate > 0 ? 60 / heatingRate : null;
  
  return {
    heat_loss_rate_deg_per_hour: heatLossRate,
    heating_rate_deg_per_hour: heatingRate,
    energy_per_degree_wh: energyPerDegree,
    solar_gain_factor: solarGainFactor.factor,
    optimal_solar_hours: solarGainFactor.optimalHours,
    avg_heating_duration_min: heatingBehavior.avgDuration,
    avg_cycles_per_day: heatingBehavior.avgCycles,
    preheat_duration_for_1deg_min: preheatDuration,
    pv_heating_ratio: efficiency.pvRatio,
    battery_dependency_ratio: efficiency.batteryRatio,
    grid_import_ratio: efficiency.gridRatio,
    confidence,
    sample_count: sampleCount
  };
}

function calculateHeatLossRate(samples: TemperatureSample[]): number | null {
  // Finde Perioden ohne Heizung und berechne Temperatur-Abfall
  const coolingPeriods: { duration: number; tempDrop: number }[] = [];
  
  for (let i = 1; i < samples.length; i++) {
    if (!samples[i].is_heating && !samples[i-1].is_heating) {
      const duration = (new Date(samples[i].timestamp).getTime() - 
                       new Date(samples[i-1].timestamp).getTime()) / 3600000; // in Stunden
      const tempDrop = samples[i-1].temperature - samples[i].temperature;
      
      if (duration > 0 && duration < 2 && tempDrop > 0) { // Max 2 Stunden, positiver Abfall
        coolingPeriods.push({ duration, tempDrop });
      }
    }
  }

  if (coolingPeriods.length === 0) return null;

  // Durchschnittliche Abkühlrate
  const rates = coolingPeriods.map(p => p.tempDrop / p.duration);
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function calculateHeatingRate(samples: TemperatureSample[]): number | null {
  // Finde Perioden mit Heizung und berechne Temperatur-Anstieg
  const heatingPeriods: { duration: number; tempGain: number }[] = [];
  
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].is_heating && samples[i-1].is_heating) {
      const duration = (new Date(samples[i].timestamp).getTime() - 
                       new Date(samples[i-1].timestamp).getTime()) / 3600000;
      const tempGain = samples[i].temperature - samples[i-1].temperature;
      
      if (duration > 0 && duration < 2 && tempGain > 0) {
        heatingPeriods.push({ duration, tempGain });
      }
    }
  }

  if (heatingPeriods.length === 0) return null;

  const rates = heatingPeriods.map(p => p.tempGain / p.duration);
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function calculateEnergyPerDegree(
  logs: RoomHeatingLog[],
  samples: TemperatureSample[]
): number | null {
  // Korreliere Heizzyklen mit Energieverbrauch
  const heatingStarts = logs.filter(l => l.event_type === 'heating_start' || l.event_type === 'solar_limit_start');
  const heatingStops = logs.filter(l => l.event_type === 'heating_stop' || l.event_type === 'solar_limit_stop');

  const cycles: { energy: number; tempGain: number }[] = [];

  for (const start of heatingStarts) {
    const stop = heatingStops.find(s => 
      new Date(s.timestamp) > new Date(start.timestamp) &&
      new Date(s.timestamp).getTime() - new Date(start.timestamp).getTime() < 3600000 * 4
    );

    if (stop && stop.energy_estimate_wh && start.current_temp && stop.current_temp) {
      const tempGain = stop.current_temp - start.current_temp;
      if (tempGain > 0.1) {
        cycles.push({ energy: stop.energy_estimate_wh, tempGain });
      }
    }
  }

  if (cycles.length === 0) return null;

  const energyPerDegree = cycles.map(c => c.energy / c.tempGain);
  return energyPerDegree.reduce((a, b) => a + b, 0) / energyPerDegree.length;
}

function calculateSolarGainFactor(
  samples: TemperatureSample[],
  energyReadings: EnergyReading[]
): { factor: number | null; optimalHours: string[] } {
  // Analysiere Temperatur-Anstiege bei hoher PV-Produktion ohne Heizung
  const solarGains: { pvPower: number; tempGain: number; hour: number }[] = [];

  for (let i = 1; i < samples.length; i++) {
    if (!samples[i].is_heating && !samples[i-1].is_heating && samples[i].pv_power_w) {
      const pvPower = samples[i].pv_power_w;
      const tempGain = samples[i].temperature - samples[i-1].temperature;
      const hour = new Date(samples[i].timestamp).getHours();

      if (pvPower && pvPower > 500 && tempGain > 0) {
        solarGains.push({ pvPower: pvPower, tempGain, hour });
      }
    }
  }

  if (solarGains.length === 0) return { factor: null, optimalHours: [] };

  // Berechne Solar-Gain-Faktor (Temperatur-Gewinn pro 1000W)
  const factors = solarGains.map(g => (g.tempGain * 1000) / g.pvPower);
  const avgFactor = factors.reduce((a, b) => a + b, 0) / factors.length;

  // Finde optimale Stunden
  const hourlyGains = new Map<number, number[]>();
  for (const g of solarGains) {
    if (!hourlyGains.has(g.hour)) hourlyGains.set(g.hour, []);
    hourlyGains.get(g.hour)!.push(g.tempGain);
  }

  const optimalHours = Array.from(hourlyGains.entries())
    .map(([hour, gains]) => ({ hour, avg: gains.reduce((a, b) => a + b, 0) / gains.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map(h => `${h.hour.toString().padStart(2, '0')}:00`);

  return { factor: avgFactor, optimalHours };
}

function calculateHeatingBehavior(logs: RoomHeatingLog[]): {
  avgDuration: number | null;
  avgCycles: number | null;
} {
  const heatingStops = logs.filter(l => 
    (l.event_type === 'heating_stop' || l.event_type === 'solar_limit_stop') && l.duration_minutes
  );
  
  if (heatingStops.length === 0) {
    return { avgDuration: null, avgCycles: null };
  }

  const avgDuration = heatingStops.reduce((sum, l) => sum + (l.duration_minutes || 0), 0) / heatingStops.length;

  // Zyklen pro Tag
  const dayMap = new Map<string, number>();
  for (const log of logs.filter(l => l.event_type === 'heating_start' || l.event_type === 'solar_limit_start')) {
    const day = log.timestamp.split('T')[0];
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const avgCycles = dayMap.size > 0 
    ? Array.from(dayMap.values()).reduce((a, b) => a + b, 0) / dayMap.size 
    : null;

  return { avgDuration, avgCycles };
}

function calculateEfficiencyMetrics(
  logs: RoomHeatingLog[],
  energyReadings: EnergyReading[]
): { pvRatio: number | null; batteryRatio: number | null; gridRatio: number | null } {
  // Analysiere Energiequelle während Heizphasen
  let pvEnergy = 0;
  let batteryEnergy = 0;
  let gridEnergy = 0;
  let totalEnergy = 0;

  const heatingPeriods = getHeatingPeriods(logs);

  for (const period of heatingPeriods) {
    const periodReadings = energyReadings.filter(r => {
      const t = new Date(r.timestamp).getTime();
      return t >= period.start && t <= period.end;
    });

    for (const reading of periodReadings) {
      const intervalHours = 1/12; // ~5 Minuten
      const pvPower = reading.pv_power || 0;
      const consumption = reading.consumption || 0;
      const gridImport = reading.power_io > 0 ? reading.power_io : 0;
      
      // Schätze Quellen
      const pvUsed = Math.min(pvPower, consumption);
      const fromGrid = gridImport;
      const fromBattery = Math.max(0, consumption - pvUsed - fromGrid);

      pvEnergy += pvUsed * intervalHours;
      gridEnergy += fromGrid * intervalHours;
      batteryEnergy += fromBattery * intervalHours;
      totalEnergy += consumption * intervalHours;
    }
  }

  if (totalEnergy === 0) {
    return { pvRatio: null, batteryRatio: null, gridRatio: null };
  }

  return {
    pvRatio: pvEnergy / totalEnergy,
    batteryRatio: batteryEnergy / totalEnergy,
    gridRatio: gridEnergy / totalEnergy
  };
}

function getHeatingPeriods(logs: RoomHeatingLog[]): { start: number; end: number }[] {
  const periods: { start: number; end: number }[] = [];
  const starts = logs.filter(l => l.event_type === 'heating_start' || l.event_type === 'solar_limit_start').sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const stops = logs.filter(l => l.event_type === 'heating_stop' || l.event_type === 'solar_limit_stop').sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const start of starts) {
    const startTime = new Date(start.timestamp).getTime();
    const stop = stops.find(s => new Date(s.timestamp).getTime() > startTime);
    if (stop) {
      periods.push({ start: startTime, end: new Date(stop.timestamp).getTime() });
    }
  }

  return periods;
}
