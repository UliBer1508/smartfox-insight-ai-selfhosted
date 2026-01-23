import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Room {
  id: string;
  name: string;
  orientation: string | null;
  current_temp: number | null;
  target_temp: number | null;
  is_heating: boolean;
  solar_heating_temp: number | null;
  calculated_solar_gain_factor: number | null;
  pv_auto_enabled: boolean;
}

interface TemperatureSample {
  id: string;
  room_id: string;
  timestamp: string;
  temperature: number;
  is_heating: boolean;
  pv_power_w: number | null;
}

interface EnergyReading {
  pv_power: number | null;
  power_io: number | null;
  battery_soc: number | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🌞 Starting solar heating monitor...');

    // Get current energy reading
    const { data: energyReading } = await supabase
      .from('energy_readings')
      .select('pv_power, power_io, battery_soc')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    const currentPvPower = energyReading?.pv_power || 0;
    const gridExport = energyReading?.power_io ? -energyReading.power_io : 0; // Negative means export

    console.log(`Current PV: ${currentPvPower}W, Grid export: ${gridExport}W`);

    // Skip if no significant PV production
    if (currentPvPower < 500) {
      console.log('Not enough PV production, skipping solar heating check');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Insufficient PV production',
        pv_power: currentPvPower 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all rooms with orientation
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name, orientation, current_temp, target_temp, is_heating, solar_heating_temp, calculated_solar_gain_factor, pv_auto_enabled');

    if (roomsError) throw roomsError;
    if (!rooms || rooms.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No rooms found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any[] = [];
    const southOrientations = ['süd', 'sud', 'south', 's', 'südost', 'südwest', 'so', 'sw'];
    const northOrientations = ['nord', 'north', 'n', 'nordost', 'nordwest', 'no', 'nw'];

    // Analyze each room
    for (const room of rooms as Room[]) {
      const isSouthFacing = room.orientation && 
        southOrientations.some(o => room.orientation!.toLowerCase().includes(o));
      const isNorthFacing = room.orientation && 
        northOrientations.some(o => room.orientation!.toLowerCase().includes(o));

      // Get temperature samples from last 60 minutes
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const { data: samples } = await supabase
        .from('room_temperature_samples')
        .select('*')
        .eq('room_id', room.id)
        .gte('timestamp', oneHourAgo)
        .order('timestamp', { ascending: true });

      if (!samples || samples.length < 2) {
        console.log(`${room.name}: Not enough samples for analysis`);
        continue;
      }

      // Calculate temperature change
      const oldestSample = samples[0] as TemperatureSample;
      const newestSample = samples[samples.length - 1] as TemperatureSample;
      
      const startTime = new Date(oldestSample.timestamp).getTime();
      const endTime = new Date(newestSample.timestamp).getTime();
      const durationHours = (endTime - startTime) / (1000 * 60 * 60);

      if (durationHours < 0.25) {
        console.log(`${room.name}: Duration too short (${durationHours.toFixed(2)}h)`);
        continue;
      }

      const tempChange = newestSample.temperature - oldestSample.temperature;
      const tempChangePerHour = tempChange / durationHours;
      const durationMinutes = Math.round(durationHours * 60);

      // Check if room was heating during this period
      const wasHeating = samples.some((s: TemperatureSample) => s.is_heating);

      // Calculate average PV during period
      const avgPvPower = samples
        .filter((s: TemperatureSample) => s.pv_power_w !== null)
        .reduce((sum: number, s: TemperatureSample) => sum + (s.pv_power_w || 0), 0) / 
        samples.filter((s: TemperatureSample) => s.pv_power_w !== null).length || currentPvPower;

      // Detect solar gain (temperature rising without heating in south-facing room)
      let solarGainDetected = false;
      let heatSource: 'solar' | 'heating' | 'both' | 'none' = 'none';
      let confidence = 0;

      if (isSouthFacing && tempChangePerHour > 0.2 && !wasHeating && avgPvPower > 2000) {
        // Significant temp rise without heating + good PV = solar gain
        solarGainDetected = true;
        heatSource = 'solar';
        confidence = Math.min(1, (tempChangePerHour / 1.5) * (avgPvPower / 5000));
        console.log(`🌞 ${room.name}: Solar gain detected! +${tempChangePerHour.toFixed(2)}°C/h`);
      } else if (wasHeating && tempChangePerHour > 0.3) {
        heatSource = isSouthFacing && avgPvPower > 2000 ? 'both' : 'heating';
        confidence = 0.8;
      } else if (tempChangePerHour < -0.1) {
        heatSource = 'none'; // Room is cooling
        confidence = 0.9;
      }

      // Store observation
      const { error: insertError } = await supabase
        .from('solar_heating_events')
        .insert({
          room_id: room.id,
          temp_start: oldestSample.temperature,
          temp_current: newestSample.temperature,
          temp_change_per_hour: Math.round(tempChangePerHour * 100) / 100,
          duration_minutes: durationMinutes,
          pv_power_w: Math.round(avgPvPower),
          is_heating: wasHeating,
          solar_gain_detected: solarGainDetected,
          heat_source: heatSource,
          confidence: Math.round(confidence * 100) / 100,
        });

      if (insertError) {
        console.error(`Error inserting solar heating event for ${room.name}:`, insertError);
      }

      results.push({
        roomId: room.id,
        name: room.name,
        orientation: room.orientation,
        isSouthFacing,
        isNorthFacing,
        tempStart: oldestSample.temperature,
        tempCurrent: newestSample.temperature,
        tempChangePerHour: Math.round(tempChangePerHour * 100) / 100,
        wasHeating,
        avgPvPower: Math.round(avgPvPower),
        solarGainDetected,
        heatSource,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    // Determine recommendations for PV surplus usage
    const southRoomsWithSolarGain = results.filter(r => r.solarGainDetected);
    const northRooms = results.filter(r => r.isNorthFacing);
    const surplus = gridExport > 0 ? gridExport : 0;

    const recommendations: any[] = [];

    // If south rooms are gaining from sun, they don't need heating
    for (const southRoom of southRoomsWithSolarGain) {
      recommendations.push({
        roomId: southRoom.roomId,
        name: southRoom.name,
        action: 'reduce_heating',
        reason: `Solar gain detected: +${southRoom.tempChangePerHour}°C/h from sun`,
        suggestedTemp: 17, // solar_heating_temp
      });
    }

    // If we have surplus and north rooms could use heating
    if (surplus > 500) {
      const coldNorthRooms = northRooms
        .filter(r => {
          const room = (rooms as Room[]).find(rm => rm.id === r.roomId);
          return room && room.current_temp && room.target_temp && 
                 room.current_temp < room.target_temp - 0.5;
        })
        .sort((a, b) => a.tempChangePerHour - b.tempChangePerHour); // Coldest first

      for (const northRoom of coldNorthRooms) {
        const room = (rooms as Room[]).find(rm => rm.id === northRoom.roomId);
        if (room) {
          recommendations.push({
            roomId: northRoom.roomId,
            name: northRoom.name,
            action: 'activate_heating',
            reason: `Use ${surplus}W surplus instead of grid export`,
            suggestedTemp: room.target_temp,
          });
        }
      }
    }

    console.log(`Solar heating analysis complete. Found ${southRoomsWithSolarGain.length} rooms with solar gain, ${recommendations.length} recommendations.`);

    return new Response(JSON.stringify({ 
      success: true, 
      results,
      recommendations,
      summary: {
        pvPower: currentPvPower,
        gridExport: gridExport,
        solarGainRooms: southRoomsWithSolarGain.length,
        recommendationsCount: recommendations.length,
      },
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
