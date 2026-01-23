import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PV_SURPLUS_THRESHOLD_ON = 500;
const DEFAULT_PV_SURPLUS_THRESHOLD_OFF = 200;
const DEFAULT_MIN_SWITCH_INTERVAL_MIN = 5;

// ============= TOKEN CACHING =============
// Cache token in memory (reused across invocations within same instance)
let cachedToken: string | null = null;
let tokenExpiry: number = 0;
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

// Helper: Check if current time is within night hours (Europe/Vienna timezone!)
function isNightTime(nightStartTime: string, nightEndTime: string): { isNight: boolean; wienTime: string; wienHour: number } {
  const now = new Date();
  
  // WICHTIG: Wien-Zeit verwenden, nicht UTC!
  const wienFormatter = new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const wienTime = wienFormatter.format(now);
  const [wienHour, wienMinute] = wienTime.split(':').map(Number);
  const currentMinutes = wienHour * 60 + wienMinute;
  
  const [startH, startM] = (nightStartTime || '22:00').split(':').map(Number);
  const [endH, endM] = (nightEndTime || '06:00').split(':').map(Number);
  
  const nightStart = startH * 60 + startM;
  const nightEnd = endH * 60 + endM;
  
  let isNight: boolean;
  // Case: Night spans midnight (e.g., 22:00-06:00)
  if (nightStart > nightEnd) {
    isNight = currentMinutes >= nightStart || currentMinutes < nightEnd;
  } else {
    // Case: Night within same day (e.g., 00:00-06:00)
    isNight = currentMinutes >= nightStart && currentMinutes < nightEnd;
  }
  
  return { isNight, wienTime, wienHour };
}

// Helper: Check if it's morning wait period (waiting for PV to become available)
function isMorningWaitPeriod(
  nightEndTime: string,
  wienHour: number,
  expectedPvKwh: number,
  pvPower: number,
  minPvPowerForStart: number = 1000
): { shouldWait: boolean; reason: string } {
  const [endH] = (nightEndTime || '08:00').split(':').map(Number);
  
  // Morning period: between night end and 2 hours after
  const morningEnd = endH + 2;
  const isMorning = wienHour >= endH && wienHour < morningEnd;
  
  if (!isMorning) {
    return { shouldWait: false, reason: '' };
  }
  
  // Good sunny day expected (>15 kWh) but PV power still low
  if (expectedPvKwh > 15 && pvPower < minPvPowerForStart) {
    return { 
      shouldWait: true, 
      reason: `Sonnentag erwartet (${expectedPvKwh.toFixed(1)} kWh) - warte auf PV (aktuell ${pvPower}W < ${minPvPowerForStart}W)`
    };
  }
  
  return { shouldWait: false, reason: '' };
}

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

// ============= CACHED TOKEN FETCH =============
async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry > now + TOKEN_BUFFER_MS) {
    console.log('[Tuya] Using cached token (expires in', Math.round((tokenExpiry - now) / 60000), 'min)');
    return cachedToken;
  }

  console.log('[Tuya] Fetching new access token...');
  const timestamp = now.toString();
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
  
  // Cache the token (Tuya tokens are valid for ~2 hours = 7200 seconds)
  cachedToken = data.result.access_token;
  const expiresIn = (data.result.expire_time || 7200) * 1000; // Convert to ms
  tokenExpiry = now + expiresIn;
  
  console.log('[Tuya] New token cached, expires in', Math.round(expiresIn / 60000), 'min');
  return cachedToken!;
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
    console.log(`[Tuya] ${deviceId} -> ${temperature}°C: ${result.success}`);
    return result.success === true;
  } catch (error) {
    console.error(`[Tuya] Error for ${deviceId}:`, error);
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

    // POST /check - ML-based automation with SKIP LOGIC
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

      // 7. Load PV forecast for today
      const today = new Date().toISOString().split('T')[0];
      const { data: pvForecast } = await supabase
        .from('pv_forecasts')
        .select('expected_kwh')
        .eq('date', today)
        .single();

      const expectedPvKwh = pvForecast?.expected_kwh || 0;
      const pvPower = reading.pv_power || 0;

      console.log(`[PV-Automation] Surplus: ${surplus}W, SOC: ${batterySoc}%, PV: ${pvPower}W, Prognose: ${expectedPvKwh} kWh, Rooms: ${rooms.length}, ML-Features: ${latestMlFeatures.length}`);

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
      let tuyaApiCalls = 0; // Track API calls for logging

      for (const room of rooms) {
        // automation_enabled controls ONLY ML recommendations, not basic time-based logic
        const useMLDecisions = room.automation_enabled === true;
        
        if (!useMLDecisions) {
          console.log(`[PV-Automation] Room ${room.name}: ML disabled, using time-based logic only`);
        }

        // Check manual override (temporary protection)
        if (room.manual_override_until) {
          const overrideUntil = new Date(room.manual_override_until);
          if (overrideUntil > now) {
            console.log(`[PV-Automation] Room ${room.name} has manual override until ${overrideUntil.toLocaleTimeString('de-DE')}`);
            results.push({
              roomId: room.id,
              roomName: room.name,
              action: 'skip',
              message: `Manueller Override bis ${overrideUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
              mlBased: false
            });
            continue;
          }
        }

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
        let targetTemp = room.target_temp || settings?.eco_temp || 19;
        let solarLimitTemp: number | null = null; // Solar-Limit: erlaubte Max-Temp bei Sonneneinstrahlung
        let reasoning = '';
        let expectedEnergyWh: number | undefined;
        let confidence: number | undefined;
        let mlDecision: MLDecision | null | undefined = null; // Außerhalb definiert für spätere Referenz

        // WICHTIG: Nachtzeit-Check ZUERST - hat IMMER Priorität über ML!
        const nightStart = settings?.night_start_time || '22:00';
        const nightEnd = settings?.night_end_time || '08:00';
        const { isNight, wienTime, wienHour } = isNightTime(nightStart, nightEnd);
        
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const comfortTemp = room.comfort_temp || settings?.comfort_temp || 21;
        const nightTemp = room.night_temp || settings?.night_temp || 17;
        // Solar-Heiztemperatur: Priorität solar_heating_temp → night_temp → 17°C
        const solarTemp = room.solar_heating_temp || room.night_temp || 17;
        
        console.log(`[PV-Automation] ${room.name}: Wien-Zeit ${wienTime}, Nacht=${isNight} (${nightStart}-${nightEnd}), has_solar_gain=${room.has_solar_gain}, solar_heating_temp=${room.solar_heating_temp}`);

        // 1. NACHTMODUS - hat absolute Priorität über ALLES (auch ML!)
        if (isNight) {
          // Robuster Vergleich (beide als Number)
          const currentTargetTemp = Number(room.target_temp) || 0;
          const needsCorrection = currentTargetTemp !== nightTemp || room.pv_auto_active;
          
          console.log(`[PV-Automation] ${room.name} Nacht-Check: target=${currentTargetTemp}°C, nightTemp=${nightTemp}°C, pv_auto=${room.pv_auto_active}, needsCorrection=${needsCorrection}`);
          
          if (needsCorrection) {
            action = 'deactivate';
            targetTemp = nightTemp;
            solarLimitTemp = null; // Kein Solar-Limit nachts
            reasoning = `Nachtmodus bis ${nightEnd} (Wien: ${wienTime})`;
          }
          // Skip ML and fallback logic during night
        } else {
          // TAGSÜBER: ML oder Fallback-Logik

          // ML decision ONLY if automation_enabled = true AND it's daytime
          mlDecision = useMLDecisions ? mlDecisions.find(d => d.room_id === room.id) : null;

          // MORGENSTUNDEN-SPERRE für Süd-Räume bei erwartetem Sonnentag
          if (room.has_solar_gain) {
            const { shouldWait, reason } = isMorningWaitPeriod(
              nightEnd,
              wienHour,
              expectedPvKwh,
              pvPower
            );
            
            if (shouldWait) {
              // Solar-Passiv-Modus: Thermostat auf niedrige Temperatur setzen und warten
              action = 'deactivate';
              targetTemp = solarTemp;
              solarLimitTemp = comfortTemp;
              reasoning = reason;
              
              console.log(`[PV-Automation] ${room.name}: MORGEN-SPERRE - ${reason}, Thermostat auf ${solarTemp}°C`);
            }
          }

          // Only process ML/fallback if action is still 'keep' (not already set by morning wait)
          if (action === 'keep') {
            if (mlDecision && usedMlDecision && useMLDecisions) {
              // Use ML/AI recommendation (nur tagsüber!)
              action = mlDecision.action;
              targetTemp = mlDecision.target_temp;
              reasoning = mlDecision.reasoning + ' (KI)';
              expectedEnergyWh = mlDecision.expected_energy_wh;
              confidence = mlDecision.confidence;
            } else {
              // Basis-Zeitschaltung / Fallback (nur tagsüber)
              
              // 2. Battery protection
              if (batterySoc < minBatterySoc && room.pv_auto_active) {
                action = 'deactivate';
                targetTemp = ecoTemp;
                solarLimitTemp = null;
                reasoning = `Batterie <${minBatterySoc}%`;
              } 
              // 3. PV surplus/Solargewinn -> Solar-Modus aktivieren
              // ABER: Nur wenn tatsächlich genug PV-Leistung vorhanden!
              else if (surplus >= thresholdOn && !room.pv_auto_active && pvPower >= 1000) {
                action = 'activate';
                
                // Solar-Modus: Bei Solargewinn-Räumen niedrige Temperatur verwenden
                if (room.has_solar_gain) {
                  targetTemp = solarTemp; // z.B. 17-18°C - Heizung bleibt aus!
                  solarLimitTemp = comfortTemp; // Raum darf sich durch Sonne bis hier erwärmen
                  reasoning = `Solar-Passiv-Modus: Thermostat ${targetTemp}°C, Sonne darf bis ${comfortTemp}°C erwärmen (${surplus}W Überschuss, ${pvPower}W PV)`;
                } else {
                  targetTemp = ecoTemp; // Normale Räume: Eco-Temperatur
                  solarLimitTemp = comfortTemp;
                  reasoning = `Solar-Limit ${comfortTemp}°C erlaubt (Überschuss ${surplus}W)`;
                }
              }
              // 3b. Überschuss vorhanden, aber PV-Leistung noch zu gering - warten
              else if (surplus >= thresholdOn && !room.pv_auto_active && pvPower < 1000 && room.has_solar_gain) {
                // Noch nicht aktivieren - warten auf mehr PV
                action = 'deactivate';
                targetTemp = solarTemp;
                solarLimitTemp = null;
                reasoning = `Warte auf PV: Überschuss ${surplus}W vorhanden aber PV-Leistung noch gering (${pvPower}W < 1000W)`;
                console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
              }
              // 4. Low/no surplus -> Solar-Limit deaktivieren
              else if (surplus < thresholdOff && room.pv_auto_active) {
                action = 'deactivate';
                targetTemp = ecoTemp;
                solarLimitTemp = null;
                reasoning = `Solar-Limit aus (Überschuss ${surplus}W < ${thresholdOff}W)`;
              } 
              // 5. Wenn Solar-Limit aktiv ist und Bedingungen noch gelten, beibehalten
              else if (room.pv_auto_active && surplus >= thresholdOff) {
                // Solar-Modus weiterhin aktiv - behalte die niedrige Temperatur bei
                if (room.has_solar_gain) {
                  targetTemp = solarTemp;
                } else {
                  targetTemp = ecoTemp;
                }
                solarLimitTemp = comfortTemp;
                // Keep action = 'keep'
              }
              // 6. Daytime default: Ensure eco temp is set
              else if (!room.pv_auto_active) {
                const currentTarget = room.target_temp || ecoTemp;
                if (currentTarget !== ecoTemp) {
                  action = 'deactivate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = null;
                  reasoning = 'Eco-Modus (Standard tagsüber)';
                }
              }
            }
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

        // ============= SKIP LOGIC: Check if Tuya API call is actually needed =============
        const currentTargetTemp = Number(room.target_temp) || 0;
        const newTargetTemp = Number(targetTemp) || 0;
        const tempAlreadyCorrect = Math.abs(currentTargetTemp - newTargetTemp) < 0.5; // 0.5°C tolerance
        const stateAlreadyCorrect = (action === 'activate' && room.pv_auto_active) || 
                                     (action === 'deactivate' && !room.pv_auto_active);
        
        if (tempAlreadyCorrect && stateAlreadyCorrect) {
          console.log(`[PV-Automation] ${room.name}: SKIP - already at ${currentTargetTemp}°C, state=${room.pv_auto_active ? 'active' : 'inactive'}`);
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'skip',
            message: `Bereits korrekt: ${currentTargetTemp}°C`,
            mlBased: usedMlDecision && !!mlDecision,
            skippedApiCall: true
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
            tuyaApiCalls++;
          }

          if (success || !room.tuya_device_id) {
            await supabase.from('rooms').update({
              pv_auto_active: true,
              pv_auto_last_change: now.toISOString(),
              target_temp: targetTemp,
              solar_limit_temp: solarLimitTemp
            }).eq('id', room.id);

            await supabase.from('room_heating_logs').insert({
              room_id: room.id,
              event_type: 'solar_limit_start',
              current_temp: room.current_temp,
              target_temp: targetTemp,
              pv_surplus_w: surplus,
              consumption_at_start_w: reading.consumption
            });

            success = true;
          }

        } else if (action === 'deactivate') {
          // Verwende die bereits berechnete targetTemp (kann nightTemp oder ecoTemp sein)
          // Fallback auf eco_temp nur wenn targetTemp nicht gesetzt wurde
          const finalTemp = targetTemp || room.eco_temp || settings?.eco_temp || 18;
          
          console.log(`[PV-Automation] ${room.name} deactivate: Setze ${finalTemp}°C (targetTemp=${targetTemp}, nightTemp=${room.night_temp || settings?.night_temp})`);

          if (room.tuya_device_id && tuyaAccessId && tuyaAccessSecret) {
            success = await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, room.tuya_device_id, finalTemp);
            tuyaApiCalls++;
          }

          if (success || !room.tuya_device_id) {
            await supabase.from('rooms').update({
              pv_auto_active: false,
              pv_auto_last_change: now.toISOString(),
              target_temp: finalTemp,
              solar_limit_temp: null // Solar-Limit zurücksetzen
            }).eq('id', room.id);

            // Calculate duration and energy for solar_limit_stop event
            let durationMinutes = 2; // Default fallback
            let energyEstimateWh = 0;

            // Find the last solar_limit_start event for this room
            const { data: lastStart } = await supabase
              .from('room_heating_logs')
              .select('timestamp, consumption_at_start_w')
              .eq('room_id', room.id)
              .eq('event_type', 'solar_limit_start')
              .order('timestamp', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (lastStart?.timestamp) {
              const startTime = new Date(lastStart.timestamp).getTime();
              const endTime = now.getTime();
              const calculatedDuration = Math.round((endTime - startTime) / 60000);
              
              // Plausibility check: Max 4 hours (240 min)
              if (calculatedDuration > 0 && calculatedDuration <= 240) {
                durationMinutes = calculatedDuration;
              }
            }

            // Calculate energy based on room power
            const effectivePower = room.calculated_power_w || room.heating_power_w || 
              (room.floor_area_m2 ? room.floor_area_m2 * 60 : 800);
            energyEstimateWh = Math.round((effectivePower * durationMinutes) / 60);

            console.log(`[PV-Automation] ${room.name} solar_limit_stop: duration=${durationMinutes}min, energy=${energyEstimateWh}Wh`);

            await supabase.from('room_heating_logs').insert({
              room_id: room.id,
              event_type: 'solar_limit_stop',
              current_temp: room.current_temp,
              target_temp: ecoTemp,
              pv_surplus_w: surplus,
              duration_minutes: durationMinutes,
              energy_estimate_wh: energyEstimateWh,
              consumption_at_start_w: lastStart?.consumption_at_start_w || null
            });

            // Delete the used solar_limit_start to prevent reuse
            if (lastStart) {
              await supabase
                .from('room_heating_logs')
                .delete()
                .eq('room_id', room.id)
                .eq('event_type', 'solar_limit_start')
                .eq('timestamp', lastStart.timestamp);
            }

            success = true;
          }
        }

        results.push({
          roomId: room.id,
          roomName: room.name,
          action,
          targetTemp,
          solarLimitTemp,
          reasoning,
          mlBased: usedMlDecision && !!mlDecision,
          confidence,
          learningEventId: eventData?.id,
          success
        });
      }

      // Trigger evaluation of old learning events (self-learning loop)
      let evaluationResult = null;
      try {
        const evalResponse = await fetch(`${supabaseUrl}/functions/v1/evaluate-decision`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ evaluate_all: true })
        });
        if (evalResponse.ok) {
          evaluationResult = await evalResponse.json();
          console.log(`[PV-Automation] Evaluated ${evaluationResult.evaluated || 0} old learning events`);
        }
      } catch (evalError) {
        console.error('[PV-Automation] Evaluation trigger error:', evalError);
      }

      console.log(`[PV-Automation] Complete. Tuya API calls: ${tuyaApiCalls}`);

      return new Response(JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        surplus,
        batterySoc,
        usedMlDecision,
        results,
        tuyaApiCalls,
        evaluatedEvents: evaluationResult?.evaluated || 0
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
