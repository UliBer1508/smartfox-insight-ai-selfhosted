import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HeatingCycle {
  roomId: string;
  roomName: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  consumptionAtStart: number | null;
  consumptionDuringAvg: number | null;
  otherRoomsHeating: number; // Count of other rooms heating at same time
}

interface PowerSample {
  estimatedPower: number;
  weight: number; // Higher weight for isolated cycles
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting heating power calculation...');

    // Get all rooms with Tuya thermostats
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .not('tuya_device_id', 'is', null);

    if (roomsError) throw roomsError;
    if (!rooms || rooms.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No rooms with thermostats found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get heating logs from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: logs, error: logsError } = await supabase
      .from('room_heating_logs')
      .select('*')
      .gte('timestamp', sevenDaysAgo.toISOString())
      .order('timestamp', { ascending: true });

    if (logsError) throw logsError;
    if (!logs || logs.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No heating logs found in the last 7 days' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build heating cycles for each room
    const heatingCycles: HeatingCycle[] = [];
    
    for (const room of rooms) {
      const roomLogs = logs.filter(l => l.room_id === room.id);
      
      for (let i = 0; i < roomLogs.length; i++) {
        const log = roomLogs[i];
        
        if (log.event_type === 'heating_stop' && log.duration_minutes > 0) {
          // Find the matching start event
          const startTime = new Date(new Date(log.timestamp).getTime() - log.duration_minutes * 60000);
          const endTime = new Date(log.timestamp);
          
          // Count other rooms heating during this period
          let otherRoomsHeating = 0;
          for (const otherRoom of rooms) {
            if (otherRoom.id === room.id) continue;
            
            const otherLogs = logs.filter(l => l.room_id === otherRoom.id);
            for (const otherLog of otherLogs) {
              if (otherLog.event_type === 'heating_start') {
                const otherStart = new Date(otherLog.timestamp);
                // Check if other room was heating during our cycle
                if (otherStart >= startTime && otherStart <= endTime) {
                  otherRoomsHeating++;
                  break;
                }
              }
            }
          }
          
          heatingCycles.push({
            roomId: room.id,
            roomName: room.name,
            startTime,
            endTime,
            durationMinutes: log.duration_minutes,
            consumptionAtStart: log.consumption_at_start_w,
            consumptionDuringAvg: log.consumption_during_avg_w,
            otherRoomsHeating,
          });
        }
      }
    }

    console.log(`Found ${heatingCycles.length} heating cycles across ${rooms.length} rooms`);

    // Calculate power estimates per room
    const roomResults: Record<string, { samples: PowerSample[], roomName: string }> = {};

    for (const cycle of heatingCycles) {
      if (!roomResults[cycle.roomId]) {
        roomResults[cycle.roomId] = { samples: [], roomName: cycle.roomName };
      }

      // Method 1: Use consumption difference if available
      if (cycle.consumptionAtStart !== null && cycle.consumptionDuringAvg !== null) {
        const powerDiff = cycle.consumptionDuringAvg - cycle.consumptionAtStart;
        
        // Only consider positive differences (heating adds power)
        if (powerDiff > 100) { // Minimum 100W to be considered valid
          // Weight: higher for isolated cycles, lower for parallel heating
          const weight = cycle.otherRoomsHeating === 0 ? 1.0 : 1.0 / (cycle.otherRoomsHeating + 1);
          
          roomResults[cycle.roomId].samples.push({
            estimatedPower: powerDiff,
            weight,
          });
          
          console.log(`[${cycle.roomName}] Cycle: ${powerDiff}W (weight: ${weight.toFixed(2)}, ${cycle.otherRoomsHeating} other rooms)`);
        }
      }
    }

    // Calculate weighted averages and update rooms
    const updates: { roomId: string; name: string; calculatedPower: number; confidence: number; samples: number }[] = [];

    for (const [roomId, data] of Object.entries(roomResults)) {
      if (data.samples.length === 0) {
        console.log(`[${data.roomName}] No valid samples, skipping`);
        continue;
      }

      // Calculate weighted average
      let totalWeight = 0;
      let weightedSum = 0;
      
      for (const sample of data.samples) {
        weightedSum += sample.estimatedPower * sample.weight;
        totalWeight += sample.weight;
      }

      const calculatedPower = Math.round(weightedSum / totalWeight);
      
      // Confidence based on:
      // - Number of samples (more = better)
      // - Weight of samples (isolated cycles = better)
      // - Consistency of samples (lower variance = better)
      const avgWeight = totalWeight / data.samples.length;
      const sampleBonus = Math.min(data.samples.length / 10, 1) * 0.5; // Up to 0.5 for 10+ samples
      const weightBonus = avgWeight * 0.3; // Up to 0.3 for high-weight samples
      
      // Calculate variance
      const powers = data.samples.map(s => s.estimatedPower);
      const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
      const variance = powers.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / powers.length;
      const cv = Math.sqrt(variance) / mean; // Coefficient of variation
      const consistencyBonus = Math.max(0, 0.2 - cv * 0.5); // Up to 0.2 for low variance
      
      const confidence = Math.min(0.95, sampleBonus + weightBonus + consistencyBonus);

      console.log(`[${data.roomName}] Calculated: ${calculatedPower}W, Confidence: ${(confidence * 100).toFixed(0)}%, Samples: ${data.samples.length}`);

      // Update room in database
      const { error: updateError } = await supabase
        .from('rooms')
        .update({
          calculated_power_w: calculatedPower,
          power_calculation_confidence: confidence,
          power_samples: data.samples.length,
          last_power_calculation: new Date().toISOString(),
        })
        .eq('id', roomId);

      if (updateError) {
        console.error(`Error updating room ${data.roomName}:`, updateError);
      } else {
        updates.push({
          roomId,
          name: data.roomName,
          calculatedPower,
          confidence,
          samples: data.samples.length,
        });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Updated ${updates.length} rooms`,
      cycles: heatingCycles.length,
      updates,
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
