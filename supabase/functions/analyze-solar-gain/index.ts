import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TemperatureSample {
  id: string;
  room_id: string;
  timestamp: string;
  temperature: number;
  is_heating: boolean;
  pv_power_w: number | null;
}

interface Room {
  id: string;
  name: string;
  orientation: string | null;
  calculated_solar_gain_factor: number | null;
  solar_gain_confidence: number | null;
  solar_gain_samples: number | null;
  calculated_heat_loss_rate: number | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting solar gain analysis...');

    // Get all rooms
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name, orientation, calculated_solar_gain_factor, solar_gain_confidence, solar_gain_samples, calculated_heat_loss_rate');

    if (roomsError) throw roomsError;
    if (!rooms || rooms.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No rooms found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const room of rooms as Room[]) {
      console.log(`Analyzing room: ${room.name}`);

      // Get temperature samples from last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: samples, error: samplesError } = await supabase
        .from('room_temperature_samples')
        .select('*')
        .eq('room_id', room.id)
        .gte('timestamp', sevenDaysAgo.toISOString())
        .order('timestamp', { ascending: true });

      if (samplesError) {
        console.error(`Error fetching samples for ${room.name}:`, samplesError);
        continue;
      }

      if (!samples || samples.length < 10) {
        console.log(`Not enough samples for ${room.name}: ${samples?.length || 0}`);
        results.push({ 
          roomId: room.id, 
          name: room.name, 
          status: 'insufficient_data', 
          sampleCount: samples?.length || 0 
        });
        continue;
      }

      // Analyze periods where heating is OFF
      const noHeatingPeriods: { samples: TemperatureSample[] }[] = [];
      let currentPeriod: TemperatureSample[] = [];

      for (const sample of samples as TemperatureSample[]) {
        if (!sample.is_heating) {
          currentPeriod.push(sample);
        } else {
          if (currentPeriod.length >= 2) {
            noHeatingPeriods.push({ samples: currentPeriod });
          }
          currentPeriod = [];
        }
      }
      if (currentPeriod.length >= 2) {
        noHeatingPeriods.push({ samples: currentPeriod });
      }

      console.log(`Found ${noHeatingPeriods.length} no-heating periods for ${room.name}`);

      // Calculate temperature changes during no-heating periods
      const solarGainObservations: { tempChangePerHour: number; pvPowerKw: number }[] = [];
      const heatLossObservations: number[] = [];

      for (const period of noHeatingPeriods) {
        const periodSamples = period.samples;
        if (periodSamples.length < 2) continue;

        // Calculate total time span in hours
        const startTime = new Date(periodSamples[0].timestamp).getTime();
        const endTime = new Date(periodSamples[periodSamples.length - 1].timestamp).getTime();
        const durationHours = (endTime - startTime) / (1000 * 60 * 60);

        if (durationHours < 0.25) continue; // Skip periods shorter than 15 minutes

        const tempChange = periodSamples[periodSamples.length - 1].temperature - periodSamples[0].temperature;
        const tempChangePerHour = tempChange / durationHours;

        // Calculate average PV power during this period
        const pvPowers = periodSamples
          .filter(s => s.pv_power_w !== null)
          .map(s => s.pv_power_w!);

        const avgPvPowerW = pvPowers.length > 0 
          ? pvPowers.reduce((a, b) => a + b, 0) / pvPowers.length 
          : 0;

        const avgPvPowerKw = avgPvPowerW / 1000;

        // Categorize based on PV production
        if (avgPvPowerKw > 2) {
          // Significant solar production - potential solar gain
          solarGainObservations.push({ tempChangePerHour, pvPowerKw: avgPvPowerKw });
        } else if (avgPvPowerKw < 0.5) {
          // Night or cloudy - pure heat loss
          heatLossObservations.push(tempChangePerHour);
        }
      }

      console.log(`Solar gain observations: ${solarGainObservations.length}, Heat loss: ${heatLossObservations.length}`);

      // Calculate heat loss rate (average temperature drop per hour without sun)
      let calculatedHeatLossRate = 0;
      if (heatLossObservations.length >= 3) {
        calculatedHeatLossRate = heatLossObservations.reduce((a, b) => a + b, 0) / heatLossObservations.length;
      }

      // Calculate solar gain factor
      // Factor = (actual temp change - expected heat loss) / PV power
      let calculatedSolarGainFactor = 0;
      let confidence = 0;

      if (solarGainObservations.length >= 3 && calculatedHeatLossRate !== 0) {
        const adjustedGains = solarGainObservations.map(obs => {
          // How much the room gained vs. expected loss
          const expectedLoss = calculatedHeatLossRate; // Already negative
          const actualGain = obs.tempChangePerHour - expectedLoss;
          return { gain: actualGain, pvPowerKw: obs.pvPowerKw };
        });

        // Calculate factor: °C gained per kW of PV
        const factors = adjustedGains.map(g => g.gain / g.pvPowerKw);
        calculatedSolarGainFactor = factors.reduce((a, b) => a + b, 0) / factors.length;

        // Calculate confidence based on sample count and variance
        const variance = factors.reduce((acc, f) => acc + Math.pow(f - calculatedSolarGainFactor, 2), 0) / factors.length;
        const stdDev = Math.sqrt(variance);
        
        // Confidence based on consistency (lower variance = higher confidence)
        // and sample count
        const consistencyScore = Math.max(0, 1 - (stdDev / Math.abs(calculatedSolarGainFactor || 0.1)));
        const sampleScore = Math.min(1, solarGainObservations.length / 20);
        confidence = consistencyScore * 0.6 + sampleScore * 0.4;
      }

      const totalSamples = samples.length;

      // Update room with calculated values
      const { error: updateError } = await supabase
        .from('rooms')
        .update({
          calculated_solar_gain_factor: Math.round(calculatedSolarGainFactor * 1000) / 1000,
          solar_gain_confidence: Math.round(confidence * 100) / 100,
          solar_gain_samples: totalSamples,
          calculated_heat_loss_rate: Math.round(calculatedHeatLossRate * 1000) / 1000,
          last_solar_analysis: new Date().toISOString(),
          // Auto-set has_solar_gain if significant gain detected
          ...(calculatedSolarGainFactor > 0.03 && confidence > 0.5 ? { has_solar_gain: true } : {})
        })
        .eq('id', room.id);

      if (updateError) {
        console.error(`Error updating room ${room.name}:`, updateError);
      }

      results.push({
        roomId: room.id,
        name: room.name,
        orientation: room.orientation,
        status: 'analyzed',
        sampleCount: totalSamples,
        solarGainObservations: solarGainObservations.length,
        heatLossObservations: heatLossObservations.length,
        calculatedSolarGainFactor: Math.round(calculatedSolarGainFactor * 1000) / 1000,
        calculatedHeatLossRate: Math.round(calculatedHeatLossRate * 1000) / 1000,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    console.log('Solar gain analysis complete:', JSON.stringify(results));

    return new Response(JSON.stringify({ 
      success: true, 
      results,
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
