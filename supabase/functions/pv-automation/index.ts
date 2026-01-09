import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PV_SURPLUS_THRESHOLD_ON = 500;
const DEFAULT_PV_SURPLUS_THRESHOLD_OFF = 200;
const DEFAULT_MIN_SWITCH_INTERVAL_MIN = 5;

interface MLDecision {
  room_id: string;
  room_name: string;
  action: 'activate' | 'deactivate' | 'keep';
  target_temp: number;
  reasoning: string;
  expected_energy_wh?: number;
  confidence?: number;
}

interface MLDecisionResponse {
  decisions?: MLDecision[];
  overall_strategy?: string;
  error?: string;
}

// Tuya API Helpers
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const path = '/v1.0/token?grant_type=1';
  const contentHash = await sha256Hash('');
  const stringToSign = ['GET', contentHash, '', path].join('\n');
  const signStr = accessId + timestamp + stringToSign;
  const sign = await hmacSha256(accessSecret, signStr);

  const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
    method: 'GET',
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();
  if (!data.success) throw new Error(`Tuya token error: ${data.msg}`);
  return data.result.access_token;
}

async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<boolean> {
  try {
    const token = await getAccessToken(accessId, accessSecret);
    const timestamp = Date.now().toString();
    const path = `/v1.0/devices/${deviceId}/commands`;
    const body = { commands: [{ code: 'temp_set', value: Math.round(temperature * 10) }] };
    const bodyStr = JSON.stringify(body);
    const contentHash = await sha256Hash(bodyStr);
    const stringToSign = ['POST', contentHash, '', path].join('\n');
    const signStr = accessId + token + timestamp + stringToSign;
    const sign = await hmacSha256(accessSecret, signStr);

    const response = await fetch(`https://openapi.tuyaeu.com${path}`, {
      method: 'POST',
      headers: {
        'client_id': accessId,
        'access_token': token,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });

    const result = await response.json();
    console.log(`Tuya ${deviceId} -> ${temperature}°C: ${result.success}`);
    return result.success === true;
  } catch (error) {
    console.error(`Tuya error for ${deviceId}:`, error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const tuyaAccessId = Deno.env.get('TUYA_ACCESS_ID');
  const tuyaAccessSecret = Deno.env.get('TUYA_ACCESS_SECRET');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/pv-automation', '');

    // GET /status
    if (path === '/status' && req.method === 'GET') {
      const { data: reading } = await supabase
        .from('energy_readings')
        .select('power_io, battery_soc, pv_power, consumption, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name, pv_auto_enabled, pv_auto_active, target_temp, current_temp')
        .eq('pv_auto_enabled', true);

      const { data: settings } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      const surplus = reading?.power_io ? -reading.power_io : 0;

      return new Response(JSON.stringify({
        success: true,
        status: {
          currentSurplus: surplus,
          batterySoc: reading?.battery_soc || 0,
          pvPower: reading?.pv_power || 0,
          consumption: reading?.consumption || 0,
          thresholds: {
            on: settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON,
            off: settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF
          },
          rooms: rooms || [],
          lastReading: reading?.timestamp
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /check - ML-based automation
    if (path === '/check' && req.method === 'POST') {
      console.log('[PV-Automation] Starting ML-based check...');

      // 1. Load latest energy reading
      const { data: reading, error: readingError } = await supabase
        .from('energy_readings')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (readingError || !reading) {
        return new Response(JSON.stringify({ success: false, error: 'No energy readings' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const surplus = -reading.power_io;
      const batterySoc = reading.battery_soc || 0;

      // 2. Load settings
      const { data: settings } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      const minBatterySoc = settings?.min_battery_soc || 20;
      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;
      const minSwitchIntervalMs = (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN) * 60 * 1000;

      // 3. Load rooms with PV automation
      const { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('pv_auto_enabled', true);

      if (roomsError || !rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No rooms with PV automation', results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. Load ML features
      const { data: mlFeatures } = await supabase
        .from('room_ml_features')
        .select('*')
        .in('room_id', rooms.map(r => r.id))
        .order('date', { ascending: false });

      // Get latest feature per room
      const latestMlFeatures: Record<string, unknown>[] = [];
      const seenRooms = new Set<string>();
      for (const f of mlFeatures || []) {
        if (!seenRooms.has(f.room_id)) {
          latestMlFeatures.push(f);
          seenRooms.add(f.room_id);
        }
      }

      // 5. Load weather data
      const { data: weatherData } = await supabase
        .from('weather_data')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      // 6. Load recent evaluated events for feedback
      const { data: recentEvents } = await supabase
        .from('learning_events')
        .select('decision_type, action, reward, reward_breakdown')
        .eq('is_evaluated', true)
        .order('timestamp', { ascending: false })
        .limit(10);

      console.log(`[PV-Automation] Surplus: ${surplus}W, SOC: ${batterySoc}%, Rooms: ${rooms.length}, ML-Features: ${latestMlFeatures.length}`);

      // 7. Call analyze-patterns with optimize_decision
      let mlDecisions: MLDecision[] = [];
      let usedMlDecision = false;

      if (tuyaAccessId && tuyaAccessSecret) {
        try {
          const mlResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-patterns`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              type: 'optimize_decision',
              readings: [reading],
              rooms: rooms,
              heatingSettings: settings,
              mlFeatures: latestMlFeatures,
              weatherData: weatherData,
              recentRewards: recentEvents
            })
          });

          if (mlResponse.ok) {
            const mlResult: MLDecisionResponse = await mlResponse.json();
            if (mlResult.decisions && mlResult.decisions.length > 0) {
              mlDecisions = mlResult.decisions;
              usedMlDecision = true;
              console.log(`[PV-Automation] ML decisions: ${mlDecisions.length}, Strategy: ${mlResult.overall_strategy}`);
            }
          } else {
            console.warn('[PV-Automation] ML decision failed, using fallback');
          }
        } catch (mlError) {
          console.error('[PV-Automation] ML error:', mlError);
        }
      }

      // 8. Process decisions
      const results: Record<string, unknown>[] = [];
      const now = new Date();

      for (const room of rooms) {
        const lastChange = room.pv_auto_last_change ? new Date(room.pv_auto_last_change) : null;
        const minutesSinceChange = lastChange ? (now.getTime() - lastChange.getTime()) / (1000 * 60) : 999;

        // Cooldown check
        if (minutesSinceChange < (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN)) {
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'cooldown',
            message: `Wait ${Math.ceil((settings?.min_switch_interval_min || 5) - minutesSinceChange)} min`,
            mlBased: false
          });
          continue;
        }

        let action: 'activate' | 'deactivate' | 'keep' = 'keep';
        let targetTemp = room.target_temp || settings?.comfort_temp || 21;
        let reasoning = '';
        let expectedEnergyWh: number | undefined;
        let confidence: number | undefined;

        // Check ML decision for this room
        const mlDecision = mlDecisions.find(d => d.room_id === room.id);

        if (mlDecision && usedMlDecision) {
          action = mlDecision.action;
          targetTemp = mlDecision.target_temp;
          reasoning = mlDecision.reasoning;
          expectedEnergyWh = mlDecision.expected_energy_wh;
          confidence = mlDecision.confidence;
        } else {
          // Fallback: Simple threshold logic
          if (batterySoc < minBatterySoc) {
            if (room.pv_auto_active) {
              action = 'deactivate';
              reasoning = `Battery <${minBatterySoc}%`;
            }
          } else if (surplus >= thresholdOn && !room.pv_auto_active) {
            action = 'activate';
            targetTemp = settings?.comfort_temp || 21;
            reasoning = `Surplus ${surplus}W >= ${thresholdOn}W`;
          } else if (surplus < thresholdOff && room.pv_auto_active) {
            action = 'deactivate';
            reasoning = `Surplus ${surplus}W < ${thresholdOff}W`;
          }
        }

        if (action === 'keep') {
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'keep',
            currentState: room.pv_auto_active ? 'active' : 'inactive',
            mlBased: usedMlDecision && !!mlDecision
          });
          continue;
        }

        // Log learning event BEFORE executing
        const eventContext = {
          surplus,
          battery_soc: batterySoc,
          pv_power: reading.pv_power,
          consumption: reading.consumption,
          room_temp: room.current_temp,
          outdoor_temp: weatherData?.temperature_c,
          cloud_cover: weatherData?.cloud_cover_percent,
          ml_confidence: confidence,
          ml_features: latestMlFeatures.find(f => f.room_id === room.id) || null
        };

        const eventAction = {
          target_temp: targetTemp,
          reasoning,
          expected_energy_wh: expectedEnergyWh,
          previous_state: room.pv_auto_active,
          ml_based: usedMlDecision && !!mlDecision
        };

        const { data: eventData, error: eventError } = await supabase
          .from('learning_events')
          .insert({
            decision_type: action,
            room_id: room.id,
            context: eventContext,
            action: eventAction,
            is_evaluated: false
          })
          .select('id')
          .single();

        if (eventError) {
          console.error(`[PV-Automation] Learning event error for ${room.name}:`, eventError);
        } else {
          console.log(`[PV-Automation] Learning event ${eventData?.id} for ${room.name}`);
        }

        // Execute action
        let success = false;

        if (action === 'activate') {
          if (room.tuya_device_id && tuyaAccessId && tuyaAccessSecret) {
            success = await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, room.tuya_device_id, targetTemp);
          }

          if (success || !room.tuya_device_id) {
            await supabase.from('rooms').update({
              pv_auto_active: true,
              pv_auto_last_change: now.toISOString(),
              target_temp: targetTemp
            }).eq('id', room.id);

            await supabase.from('room_heating_logs').insert({
              room_id: room.id,
              event_type: 'heating_start',
              current_temp: room.current_temp,
              target_temp: targetTemp,
              pv_surplus_w: surplus,
              consumption_at_start_w: reading.consumption
            });

            success = true;
          }

        } else if (action === 'deactivate') {
          const ecoTemp = room.eco_temp || settings?.eco_temp || 18;

          if (room.tuya_device_id && tuyaAccessId && tuyaAccessSecret) {
            success = await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, room.tuya_device_id, ecoTemp);
          }

          if (success || !room.tuya_device_id) {
            await supabase.from('rooms').update({
              pv_auto_active: false,
              pv_auto_last_change: now.toISOString(),
              target_temp: ecoTemp
            }).eq('id', room.id);

            await supabase.from('room_heating_logs').insert({
              room_id: room.id,
              event_type: 'heating_stop',
              current_temp: room.current_temp,
              target_temp: ecoTemp,
              pv_surplus_w: surplus
            });

            success = true;
          }
        }

        results.push({
          roomId: room.id,
          roomName: room.name,
          action,
          targetTemp,
          reasoning,
          mlBased: usedMlDecision && !!mlDecision,
          confidence,
          learningEventId: eventData?.id,
          success
        });
      }

      return new Response(JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        surplus,
        batterySoc,
        usedMlDecision,
        results
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[PV-Automation] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
