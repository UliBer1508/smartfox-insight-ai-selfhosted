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

// ============= ML-BASIERTE OPTIMALE HEIZSTUNDEN =============
// Prüft ob die aktuelle Stunde in den gelernten optimal_solar_hours des Raums liegt
interface OptimalHeatingResult {
  canHeat: boolean;
  reason: string;
  optimalHours: string[] | null;
  isLearningPhase: boolean;
}

interface RoomMLFeatures {
  room_id: string;
  optimal_solar_hours?: string[] | null;
  pv_heating_ratio?: number | null;
  grid_import_ratio?: number | null;
  avg_heating_duration_min?: number | null;
  sample_count?: number | null;
}

function isOptimalHeatingTime(
  roomId: string,
  mlFeatures: RoomMLFeatures[],
  wienHour: number,
  batterySoc: number,
  pvPower: number
): OptimalHeatingResult {
  const roomFeatures = mlFeatures.find(f => f.room_id === roomId);
  
  // Keine ML-Daten oder zu wenig Samples → Lernphase, erlaube alles
  if (!roomFeatures || !roomFeatures.optimal_solar_hours?.length || (roomFeatures.sample_count || 0) < 10) {
    return { 
      canHeat: true, 
      reason: 'Lernphase aktiv (noch keine optimalen Stunden berechnet)',
      optimalHours: null,
      isLearningPhase: true
    };
  }
  
  const currentHourStr = `${String(wienHour).padStart(2, '0')}:00`;
  const optimalHours = roomFeatures.optimal_solar_hours;
  const isOptimal = optimalHours.includes(currentHourStr);
  
  if (isOptimal) {
    return { 
      canHeat: true, 
      reason: `✅ Optimale Heizstunde (ML: ${optimalHours.join(', ')})`,
      optimalHours,
      isLearningPhase: false
    };
  }
  
  // Außerhalb optimaler Stunden: Prüfe Ausnahmen
  
  // Ausnahme 1: Batterie sehr voll (>80%) - nutze den Überschuss
  if (batterySoc > 80) {
    return { 
      canHeat: true, 
      reason: `Batterie >80% (${batterySoc.toFixed(0)}%), außerhalb optimaler Stunden erlaubt`,
      optimalHours,
      isLearningPhase: false
    };
  }
  
  // Ausnahme 2: PV produziert bereits genug (>2000W) - dann heizen sinnvoll
  if (pvPower > 2000) {
    return { 
      canHeat: true, 
      reason: `Hohe PV-Produktion (${pvPower}W), außerhalb optimaler Stunden erlaubt`,
      optimalHours,
      isLearningPhase: false
    };
  }
  
  // Sonst: NICHT heizen - warte auf optimale Stunden
  return { 
    canHeat: false, 
    reason: `⏳ Warte auf optimale Stunden: ${optimalHours.join(', ')} (aktuell ${wienHour}:00, SOC ${batterySoc.toFixed(0)}%, PV ${pvPower}W)`,
    optimalHours,
    isLearningPhase: false
  };
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

interface TuyaResult {
  success: boolean;
  errorType?: string;
  errorMessage?: string;
}

// Set device temperature - TGP508 only supports temp_set via Cloud API
// NOTE: Mode command ('home') removed - causes Error 2008 on TGP508 thermostats
// Thermostats in "Programmiermodus" (auto) follow Cloud temp_set commands
async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<TuyaResult> {
  try {
    const token = await getAccessToken(accessId, accessSecret);
    const timestamp = Date.now().toString();
    const path = `/v1.0/devices/${deviceId}/commands`;
    
    // Only send temp_set - mode command not supported by TGP508 Cloud API
    const commands = [{ code: 'temp_set', value: Math.round(temperature * 10) }];
    
    const body = { commands };
    const bodyStr = JSON.stringify(body);
    const contentHash = await sha256Hash(bodyStr);
    const stringToSign = ['POST', contentHash, '', path].join('\n');
    const signStr = accessId + token + timestamp + stringToSign;
    const sign = await hmacSha256(accessSecret, signStr);

    console.log(`[Tuya] ${deviceId} -> ${temperature}°C`);

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
    console.log(`[Tuya] ${deviceId} -> ${temperature}°C: success=${result.success}, code=${result.code}`);
    
    if (result.success === true) {
      return { success: true };
    }
    
    // Determine error type from Tuya error codes
    const errorType = result.code === 1010 ? 'token_expired'
      : result.code === 2009 ? 'device_offline'
      : 'tuya_api';
    
    return { 
      success: false, 
      errorType, 
      errorMessage: result.msg || `Tuya error code: ${result.code}` 
    };
  } catch (error) {
    console.error(`[Tuya] Error for ${deviceId}:`, error);
    return { 
      success: false, 
      errorType: 'tuya_api', 
      errorMessage: String(error) 
    };
  }
}

// Dual-mode: Set temperature via Cloud API or local command queue
async function setTemperatureByMode(
  supabase: ReturnType<typeof createClient>,
  accessId: string | undefined,
  accessSecret: string | undefined,
  deviceId: string,
  roomId: string,
  temperature: number,
  controlMode: string
): Promise<TuyaResult> {
  if (controlMode === 'local') {
    console.log(`[PV-Automation] Local mode: queuing set_temp ${temperature}°C for room ${roomId}`);
    const { error } = await supabase.from('thermostat_commands').insert({
      room_id: roomId,
      command: 'set_temp',
      value: temperature,
      status: 'pending',
    });
    if (error) {
      console.error(`[PV-Automation] Failed to queue command:`, error);
      return { success: false, errorType: 'local_queue', errorMessage: error.message };
    }
    return { success: true };
  }

  // Cloud mode
  if (!accessId || !accessSecret) {
    return { success: false, errorType: 'config', errorMessage: 'Tuya credentials not configured for cloud mode' };
  }
  return await setDeviceTemperature(accessId, accessSecret, deviceId, temperature);
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

    // POST /check - ML-based automation with SKIP LOGIC and NIGHT PAUSE
    if (path === '/check' && req.method === 'POST') {
      console.log('[PV-Automation] Starting ML-based check...');

      // Load control mode from system_settings
      const { data: modeData } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .single();

      const controlMode = (modeData?.value as { mode?: string })?.mode || 'cloud';
      console.log(`[PV-Automation] Control mode: ${controlMode}`);

      // 2. Load settings FIRST (needed for night check)
      const { data: settings } = await supabase
        .from('heating_settings')
        .select('*')
        .limit(1)
        .single();

      // NIGHT PAUSE: Skip Tuya cloud calls during night hours to save API quota
      const nightStartTime = settings?.night_start_time || '22:00';
      const nightEndTime = settings?.night_end_time || '06:00';
      const { isNight, wienTime } = isNightTime(nightStartTime, nightEndTime);
      
      if (isNight) {
        console.log(`[PV-Automation] Night mode active (${wienTime}) - checking if thermostats need adjustment...`);
        
        // Load battery SOC for battery protection check
        const { data: latestReading } = await supabase
          .from('energy_readings')
          .select('battery_soc')
          .order('timestamp', { ascending: false })
          .limit(1)
          .single();
        
        const nightBatterySoc = latestReading?.battery_soc || 0;
        const batteryLow = nightBatterySoc < 30;
        
        // Load all rooms with Tuya devices to check night temp
        const { data: allRooms } = await supabase
          .from('rooms')
          .select('id, name, tuya_device_id, target_temp, night_temp, pv_auto_active')
          .not('tuya_device_id', 'is', null);
        
        if (!allRooms || allRooms.length === 0) {
          return new Response(JSON.stringify({ 
            success: true, 
            message: `Nachtmodus aktiv (${wienTime}) - keine Thermostate konfiguriert`,
            nightMode: true,
            results: [] 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Filter rooms that need night temp adjustment
        // Bei niedrigem SOC: 15°C statt night_temp (Batterie-Schutz)
        const globalNightTemp = settings?.night_temp || 17;
        console.log(`[PV-Automation] Night: SOC=${nightBatterySoc}%, batteryLow=${batteryLow}, globalNightTemp=${globalNightTemp}°C`);
        
        const roomsNeedingAdjustment = allRooms.filter(r => {
          const currentTarget = Number(r.target_temp) || 0;
          const normalNightTarget = r.night_temp || globalNightTemp;
          // Batterie-Schutz: Bei SOC < 30% auf 15°C setzen
          const effectiveTarget = batteryLow ? 15 : normalNightTarget;
          // Need adjustment if difference >= 0.5°C
          return Math.abs(currentTarget - effectiveTarget) >= 0.5;
        });

        if (roomsNeedingAdjustment.length === 0) {
          const status = batteryLow ? `Batterie-Schutz aktiv (SOC ${nightBatterySoc}%)` : 'Nachttemperatur';
          console.log(`[PV-Automation] Night mode: all ${allRooms.length} thermostats already at ${status}`);
          return new Response(JSON.stringify({ 
            success: true, 
            message: `Nachtmodus aktiv (${wienTime}) - alle ${allRooms.length} Thermostate bereits auf ${status}`,
            nightMode: true,
            batteryLow,
            batterySoc: nightBatterySoc,
            thermostatsChecked: allRooms.length,
            results: [] 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Set night temp for rooms that need it
        console.log(`[PV-Automation] Night mode: ${roomsNeedingAdjustment.length}/${allRooms.length} rooms need adjustment${batteryLow ? ' (BATTERY PROTECTION → 15°C)' : ''}`);
        const nightResults: { roomId: string; roomName: string; success: boolean; nightTemp: number; error?: string }[] = [];

        {
          for (const room of roomsNeedingAdjustment) {
            const normalNightTarget = room.night_temp || globalNightTemp;
            // Batterie-Schutz: 15°C bei leerem Akku
            const nightTarget = batteryLow ? 15 : normalNightTarget;
            console.log(`[PV-Automation] Night: Setting ${room.name} to ${nightTarget}°C (was ${room.target_temp}°C)${batteryLow ? ' [BATTERY PROTECTION]' : ''} (mode: ${controlMode})`);
            
            const result = await setTemperatureByMode(
              supabase, tuyaAccessId, tuyaAccessSecret,
              room.tuya_device_id!, room.id, nightTarget, controlMode
            );

            if (result.success) {
              // Update database
              await supabase.from('rooms').update({
                target_temp: nightTarget,
                pv_auto_active: false,
                heating_paused_reason: batteryLow ? `Batterie-Schutz (SOC ${nightBatterySoc}%)` : null,
                updated_at: new Date().toISOString()
              }).eq('id', room.id);
              
              nightResults.push({
                roomId: room.id,
                roomName: room.name,
                success: true,
                nightTemp: nightTarget
              });
            } else {
              console.error(`[PV-Automation] Night: Failed to set ${room.name}: ${result.errorMessage}`);
              nightResults.push({
                roomId: room.id,
                roomName: room.name,
                success: false,
                nightTemp: nightTarget,
                error: result.errorMessage
              });
            }
          }
        }

        const successCount = nightResults.filter(r => r.success).length;
        return new Response(JSON.stringify({ 
          success: true, 
          message: `Nachtmodus aktiv (${wienTime})${batteryLow ? ' [BATTERIE-SCHUTZ]' : ''} - ${successCount}/${roomsNeedingAdjustment.length} Thermostate angepasst`,
          nightMode: true,
          batteryLow,
          batterySoc: nightBatterySoc,
          adjusted: successCount,
          total: allRooms.length,
          results: nightResults 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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

      const minBatterySoc = settings?.min_battery_soc || 20;
      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;
      const minSwitchIntervalMs = (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN) * 60 * 1000;

      // 3. Load ALL automated rooms - not just those with PV heating
      // This ensures rooms with pv_auto_enabled=false still get:
      // - Night mode (night_temp)
      // - Budget pause (15°C when PV is low)
      // - But NO active PV heating to comfort temp
      const { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('automation_enabled', true)
        .not('tuya_device_id', 'is', null);

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

      // 8. Load recent solar heating events (last 60 min) for real-time solar gain detection
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: solarEvents } = await supabase
        .from('solar_heating_events')
        .select('room_id, temp_change_per_hour, solar_gain_detected, heat_source, confidence')
        .gte('timestamp', oneHourAgo)
        .eq('solar_gain_detected', true)
        .order('timestamp', { ascending: false });

      // Create lookup for rooms with active solar gain
      const roomsWithSolarGain = new Map<string, { tempChangePerHour: number; confidence: number }>();
      for (const event of solarEvents || []) {
        if (!roomsWithSolarGain.has(event.room_id)) {
          roomsWithSolarGain.set(event.room_id, {
            tempChangePerHour: event.temp_change_per_hour || 0,
            confidence: event.confidence || 0
          });
        }
      }

      // Calculate grid export (negative power_io means export)
      const gridExport = reading.power_io < 0 ? -reading.power_io : 0;
      
      // Identify north-facing rooms that could use surplus
      const northOrientations = ['nord', 'north', 'n', 'nordost', 'nordwest', 'no', 'nw'];
      const northRooms = rooms.filter(r => 
        r.orientation && northOrientations.some(o => r.orientation!.toLowerCase().includes(o))
      );

      // ============= LEISTUNGSBUDGET-MANAGEMENT =============
      // Berechne verfügbares Budget basierend auf PV-Leistung oder Netz-Maximum
      const powerBudgetEnabled = settings?.power_budget_enabled !== false;
      const maxGridHeatingPower = settings?.max_grid_heating_power_w || 2000;
      const powerBudgetTolerance = settings?.power_budget_tolerance_w || 200;
      const roomRotationMinutes = settings?.room_rotation_minutes || 30;
      const minRoomPauseMinutes = settings?.min_room_pause_minutes || 15;
      
      // Grundlast schätzen (Verbrauch ohne Heizung, typisch 400-600W)
      const baseLoad = 500; // TODO: könnte aus Verbrauchs-Analyse kommen
      
      // Budget-Modus bestimmen
      let budgetMode: 'pv_optimized' | 'grid_sequential' | 'unlimited' = 'unlimited';
      let availableBudget = 999999; // Unlimited default
      
      if (powerBudgetEnabled) {
        if (pvPower > 500) {
          // PV-Optimiert: Nur so viel heizen wie PV produziert
          budgetMode = 'pv_optimized';
          availableBudget = Math.max(0, pvPower - baseLoad + powerBudgetTolerance);
        } else {
          // Zu wenig PV: KEIN aktives Heizen erlaubt
          // Alle Räume gehen auf Stopp-Temperatur (15°C)
          budgetMode = 'grid_sequential';
          availableBudget = 0;
          console.log(`[PV-Automation] Wenig PV (${pvPower}W < 500W) - kein Budget für aktives Heizen`);
        }
      }
      
      // Räume nach Priorität und Temperatur-Defizit sortieren
      // Typen inline für Deno Kompatibilität
      const now = new Date();
      const roomsWithPriority = rooms.map(room => {
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = room.current_temp || ecoTemp;
        const tempDeficit = ecoTemp - currentTemp;
        const heatingPower = room.calculated_power_w || room.heating_power_w || 800;
        
        // Wartezeit seit letzter Heizung
        const lastEnd = room.last_heating_end ? new Date(room.last_heating_end) : null;
        const waitTimeMinutes = lastEnd ? (now.getTime() - lastEnd.getTime()) / (1000 * 60) : 999;
        
        // Aktuelle Heizdauer
        const lastStart = room.last_heating_start ? new Date(room.last_heating_start) : null;
        const isCurrentlyHeating = room.is_heating === true;
        const heatingDurationMinutes = isCurrentlyHeating && lastStart ? 
          (now.getTime() - lastStart.getTime()) / (1000 * 60) : 0;
        
        return {
          room,
          priority: room.priority || 2,
          tempDeficit,
          heatingPower,
          waitTimeMinutes,
          isCurrentlyHeating,
          heatingDurationMinutes
        };
      });
      
      // Sortierung: 1. Priorität (aufsteigend: 1 vor 2 vor 3), 2. Temperatur-Defizit (größter zuerst), 3. Wartezeit (längste zuerst)
      roomsWithPriority.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (Math.abs(a.tempDeficit - b.tempDeficit) > 0.5) return b.tempDeficit - a.tempDeficit;
        return b.waitTimeMinutes - a.waitTimeMinutes;
      });
      
      // Tracking für Budget-Verbrauch
      let usedBudget = 0;
      const roomBudgetStatus = new Map<string, { 
        allowedToHeat: boolean; 
        reason: string; 
        shouldRotate: boolean;
      }>();
      
      // Erste Runde: Bereits heizende Räume prüfen auf Rotation
      for (const rp of roomsWithPriority) {
        if (!rp.isCurrentlyHeating) continue;
        
        // Rotation: Hat dieser Raum zu lange geheizt?
        const shouldRotate = rp.heatingDurationMinutes >= roomRotationMinutes && 
          roomsWithPriority.some(other => 
            !other.isCurrentlyHeating && 
            other.tempDeficit > 0.5 && 
            other.waitTimeMinutes >= minRoomPauseMinutes &&
            other.priority <= rp.priority
          );
        
        if (shouldRotate) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Rotation nach ${Math.round(rp.heatingDurationMinutes)} Min`,
            shouldRotate: true
          });
        } else if (usedBudget + rp.heatingPower <= availableBudget) {
          // Weiter heizen erlaubt
          usedBudget += rp.heatingPower;
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: `Weiter heizen (${usedBudget}/${availableBudget}W)`,
            shouldRotate: false
          });
        } else {
          // Budget erschöpft
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Budget erschöpft (${usedBudget}/${availableBudget}W)`,
            shouldRotate: false
          });
        }
      }
      
      // Zweite Runde: Nicht-heizende Räume nach Priorität aktivieren
      for (const rp of roomsWithPriority) {
        if (rp.isCurrentlyHeating) continue;
        
        // Mindest-Pause prüfen
        if (rp.waitTimeMinutes < minRoomPauseMinutes && rp.room.last_heating_end) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Pause: noch ${Math.ceil(minRoomPauseMinutes - rp.waitTimeMinutes)} Min`,
            shouldRotate: false
          });
          continue;
        }
        
        // Budget-Check
        if (usedBudget + rp.heatingPower <= availableBudget) {
          usedBudget += rp.heatingPower;
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: `Aktiviert (${usedBudget}/${availableBudget}W)`,
            shouldRotate: false
          });
        } else {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W`,
            shouldRotate: false
          });
        }
      }
      
      console.log(`[PV-Automation] Budget-Modus: ${budgetMode}, Budget: ${availableBudget}W, Verwendet: ${usedBudget}W`);
      console.log(`[PV-Automation] Surplus: ${surplus}W, GridExport: ${gridExport}W, SOC: ${batterySoc}%, PV: ${pvPower}W, Prognose: ${expectedPvKwh} kWh, Rooms: ${rooms.length}, ML-Features: ${latestMlFeatures.length}, SolarGain-Räume: ${roomsWithSolarGain.size}, Nord-Räume: ${northRooms.length}`);

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

          console.log(`[PV-Automation] ML Response status: ${mlResponse.status}, ok: ${mlResponse.ok}`);
          
          if (mlResponse.ok) {
            const mlResult: MLDecisionResponse = await mlResponse.json();
            console.log(`[PV-Automation] ML Result received, decisions: ${mlResult.decisions?.length || 0}, error: ${mlResult.error || 'none'}`);
            
            if (mlResult.decisions && mlResult.decisions.length > 0) {
              mlDecisions = mlResult.decisions;
              usedMlDecision = true;
              console.log(`[PV-Automation] ✅ ML decisions: ${mlDecisions.length}, Strategy: ${mlResult.overall_strategy?.substring(0, 100)}...`);
            } else {
              console.warn(`[PV-Automation] ⚠️ ML returned empty decisions array, overall_strategy: ${mlResult.overall_strategy?.substring(0, 50) || 'none'}`);
            }
          } else {
            const errorText = await mlResponse.text();
            console.warn(`[PV-Automation] ❌ ML decision failed (${mlResponse.status}): ${errorText.substring(0, 200)}`);
          }
        } catch (mlError) {
          console.error('[PV-Automation] ❌ ML error:', mlError);
        }

        // ============= PERSISTIERE ML-ENTSCHEIDUNGEN IN DATENBANK =============
        // Damit das Frontend die Empfehlungen anzeigen kann (useRooms, RoomRecommendations)
        if (mlDecisions && mlDecisions.length > 0) {
          try {
            // WICHTIG: Wien-Zeit für korrektes Datum (nicht UTC!)
            const persistNow = new Date(); // Eigene Date-Instanz für Persistierung
            const wienDateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' });
            const wienTimeFormatter = new Intl.DateTimeFormat('de-AT', {
              timeZone: 'Europe/Vienna',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
            
            const todayLocal = wienDateFormatter.format(persistNow); // YYYY-MM-DD in Wien-Zeit
            const wienTimeStr = wienTimeFormatter.format(persistNow);
            const [wienHourStr] = wienTimeStr.split(':');
            const currentHour = parseInt(wienHourStr, 10);
            
            // 8 Tagesperioden à 3 Stunden (0-3, 3-6, 6-9, ...)
            const periodNumber = Math.floor(currentHour / 3);
            const startHour = periodNumber * 3;
            const endHour = Math.min((periodNumber + 1) * 3, 24);
            const startTime = `${String(startHour).padStart(2, '0')}:00`;
            const endTime = `${String(endHour).padStart(2, '0')}:00`;
            
            console.log(`[PV-Automation] Persistiere ${mlDecisions.length} ML-Entscheidungen für ${todayLocal}, Periode ${periodNumber} (${startTime}-${endTime})`);
            
            for (const decision of mlDecisions) {
              // Map ML action to priority string
              const priorityMap: Record<string, string> = {
                'activate': 'heat_now',
                'deactivate': 'reduce',
                'keep': 'hold'
              };
              const priority = priorityMap[decision.action] || 'hold';
              
              const { error: upsertError } = await supabase
                .from('room_recommendations')
                .upsert({
                  room_id: decision.room_id,
                  date: todayLocal,
                  period_number: periodNumber,
                  start_time: startTime,
                  end_time: endTime,
                  recommended_temp: decision.target_temp,
                  reason: decision.reasoning || `ML: ${decision.action}`,
                  priority: priority,
                }, {
                  onConflict: 'room_id,date,period_number'
                });
              
              if (upsertError) {
                console.error(`[PV-Automation] Fehler beim Speichern für ${decision.room_name}:`, upsertError.message);
              }
            }
            
            console.log(`[PV-Automation] ✅ ${mlDecisions.length} ML-Entscheidungen in room_recommendations gespeichert`);
          } catch (persistError) {
            console.error('[PV-Automation] Fehler beim Persistieren der ML-Entscheidungen:', persistError);
          }
        }
      }

      // ============= LEARNED POLICIES LADEN =============
      // Epsilon-Greedy: Nutze gelernte Policies wenn genügend Daten vorhanden
      const policyNightStart = settings?.night_start_time || '22:00';
      const policyNightEnd = settings?.night_end_time || '08:00';
      const { wienHour: currentWienHour } = isNightTime(policyNightStart, policyNightEnd);
      
      let learnedPolicies: Map<string, any> = new Map();
      try {
        const { data: policies } = await supabase
          .from('learned_policies')
          .select('*')
          .eq('hour_of_day', currentWienHour);
        
        if (policies && policies.length > 0) {
          for (const p of policies) {
            learnedPolicies.set(p.room_id, p);
          }
          console.log(`[PV-Automation] Loaded ${policies.length} learned policies for hour ${currentWienHour}`);
        }
      } catch (policyError) {
        console.warn('[PV-Automation] Could not load learned policies:', policyError);
      }

      // 8. Process decisions
      const results: Record<string, unknown>[] = [];
      // now ist bereits oben im Budget-Code definiert
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
          
          // Batterie-Schutz: Bei niedrigem SOC (< 30%) auf 15°C statt night_temp
          // Thermostate stoppen sofort, da Raumtemp > 15°C
          const batteryLow = batterySoc !== null && batterySoc < 30;
          const effectiveNightTemp = batteryLow ? 15 : nightTemp;
          
          const needsCorrection = currentTargetTemp !== effectiveNightTemp || room.pv_auto_active;
          
          console.log(`[PV-Automation] ${room.name} Nacht-Check: target=${currentTargetTemp}°C, nightTemp=${nightTemp}°C, effectiveNightTemp=${effectiveNightTemp}°C, batteryLow=${batteryLow} (SOC=${batterySoc}%), pv_auto=${room.pv_auto_active}, needsCorrection=${needsCorrection}`);
          
          if (needsCorrection) {
            action = 'deactivate';
            targetTemp = effectiveNightTemp;
            solarLimitTemp = null; // Kein Solar-Limit nachts
            reasoning = batteryLow 
              ? `🔋 Nacht + Batterie niedrig (${batterySoc?.toFixed(0)}% < 30%) → ${effectiveNightTemp}°C (Schutz)`
              : `Nachtmodus bis ${nightEnd} (Wien: ${wienTime})`;
          }
          // Skip ML and fallback logic during night
        } else {
          // TAGSÜBER: ML oder Fallback-Logik

          // ML decision: Erst Learned Policy prüfen, dann LLM als Fallback
          const learnedPolicy = useMLDecisions ? learnedPolicies.get(room.id) : null;
          
          if (learnedPolicy && learnedPolicy.sample_count >= 20 && learnedPolicy.success_rate > 0.5) {
            // EXPLOITATION: Gelernte Policy nutzen (genug Daten + gute Erfolgsrate)
            action = learnedPolicy.recommended_action === 'activate' ? 'activate' : 
                     learnedPolicy.recommended_action === 'deactivate' ? 'deactivate' : 'keep';
            if (learnedPolicy.recommended_temp) {
              targetTemp = learnedPolicy.recommended_temp;
            }
            reasoning = `📊 Gelernte Policy (${learnedPolicy.sample_count} Samples, ${(learnedPolicy.success_rate*100).toFixed(0)}% Erfolg, avg_reward: ${learnedPolicy.avg_reward?.toFixed(2)})`;
            console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
          } else {
            // EXPLORATION: LLM-Entscheidung nutzen (zu wenig Daten oder schlechte Ergebnisse)
            mlDecision = useMLDecisions ? mlDecisions.find(d => d.room_id === room.id) : null;
            if (learnedPolicy) {
              console.log(`[PV-Automation] ${room.name}: Policy unzureichend (${learnedPolicy.sample_count} Samples, ${(learnedPolicy.success_rate*100).toFixed(0)}% Erfolg) → LLM-Exploration`);
            }
          }

          // ============= MORGEN-AUFWÄRMPHASE nach Nachtende =============
          // NEUE LOGIK: Prüfe zuerst ob aktuelle Stunde in optimal_solar_hours liegt
          // Statt blind um 08:00 zu heizen, warte auf PV-optimale Stunden
          const currentTargetTemp = Number(room.target_temp) || 0;
          const needsMorningWakeup = currentTargetTemp < ecoTemp || 
            (Math.abs(currentTargetTemp - nightTemp) < 0.5 && !room.pv_auto_active);
          
          if (needsMorningWakeup) {
            // Prüfe ML-basierte optimale Heizstunden
            const optimalCheck = isOptimalHeatingTime(
              room.id, 
              latestMlFeatures as RoomMLFeatures[], 
              wienHour, 
              batterySoc,
              pvPower
            );
            
            if (optimalCheck.canHeat) {
              action = 'activate';  // activate erzwingt Tuya-Sync
              targetTemp = ecoTemp;
              solarLimitTemp = null;
              
              if (optimalCheck.isLearningPhase) {
                reasoning = `Morgen-Aufwärmen: ${currentTargetTemp}°C → ${ecoTemp}°C (${optimalCheck.reason})`;
              } else {
                reasoning = `Morgen-Aufwärmen: ${optimalCheck.reason}`;
              }
              console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
            } else {
              // ⚠️ NEUE LOGIK: NICHT heizen - warte auf optimale Stunden!
              action = 'keep';  // Behalte aktuelle (niedrige) Temperatur
              targetTemp = nightTemp; // Bleibe auf Nachttemperatur
              solarLimitTemp = null;
              reasoning = `🛑 Morgen-Sperre: ${optimalCheck.reason}`;
              console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
              
              // Raum-Status aktualisieren um zu zeigen warum er wartet
              await supabase
                .from('rooms')
                .update({ heating_paused_reason: 'waiting_for_optimal_hours' })
                .eq('id', room.id);
            }
          }
          // ============= NEUE SOLAR-ERKENNUNG IN ECHTZEIT =============
          // Check if this room is currently gaining heat from the sun
          else {
            const realtimeSolarGain = roomsWithSolarGain.get(room.id);
          
            if (realtimeSolarGain && realtimeSolarGain.tempChangePerHour > 0.3 && realtimeSolarGain.confidence > 0.5) {
              // Room is actively being heated by the sun - reduce thermostat!
              action = 'deactivate';
              targetTemp = solarTemp;
              solarLimitTemp = comfortTemp;
              reasoning = `🌞 Echtzeit-Solargewinn erkannt: +${realtimeSolarGain.tempChangePerHour.toFixed(1)}°C/h durch Sonne (Konf: ${Math.round(realtimeSolarGain.confidence * 100)}%)`;
              console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
            }
            // ============= MORGEN-SPERRE für Süd-Räume bei erwartetem Sonnentag =============
            else if (room.has_solar_gain) {
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
          }

          // Only process ML/fallback if action is still 'keep' (not already set by morning wake-up or solar)
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
              // 6. Daytime default: Ensure eco temp is set if still on night temp
              else if (!room.pv_auto_active && currentTargetTemp < ecoTemp) {
                action = 'activate';
                targetTemp = ecoTemp;
                solarLimitTemp = null;
                reasoning = `Eco-Modus (Standard tagsüber): ${currentTargetTemp}°C → ${ecoTemp}°C`;
              }
              
              // ============= ÜBERSCHUSS-UMLEITUNG zu Nord-Räumen =============
              // If we have significant grid export and this is a north room, use the surplus for heating
              const isNorthRoom = room.orientation && northOrientations.some(o => room.orientation!.toLowerCase().includes(o));
              
              if (action === 'keep' && isNorthRoom && gridExport > 500 && !room.pv_auto_active) {
                // Check if room is below target and could use heating
                const currentRoomTemp = room.current_temp || 0;
                const roomNeedsHeating = currentRoomTemp < (ecoTemp - 0.5);
                
                // Check if south rooms are being heated by sun (don't need heating power)
                const southRoomsHeatedBySun = Array.from(roomsWithSolarGain.keys()).length > 0;
                
                if (roomNeedsHeating && southRoomsHeatedBySun) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                  reasoning = `⚡ Überschuss-Nutzung: ${gridExport}W Export → Nord-Raum heizen statt einspeisen (Süd-Räume durch Sonne erwärmt)`;
                  console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
                } else if (roomNeedsHeating && gridExport > 1000) {
                  // Even without detected solar gain, use significant surplus
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                  reasoning = `⚡ Hoher Überschuss: ${gridExport}W Export → Nord-Raum heizen (${currentRoomTemp.toFixed(1)}°C < ${ecoTemp}°C)`;
                  console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
                }
              }
            }
          }
        }

        // ============= LEISTUNGSBUDGET-OVERRIDE =============
        // Sequenzielles Heizen: Aktive Räume auf Comfort, Wartende auf Night-Temp
        // Das verhindert dass wartende Thermostate autonom heizen
        // Budget-Logik auch nachts bei leerem Akku aktiv (verhindert Netz-Heizen)
        if (powerBudgetEnabled && (!isNight || (batterySoc !== null && batterySoc < 30))) {
          const budgetStatus = roomBudgetStatus.get(room.id);
          
          if (budgetStatus) {
            if (budgetStatus.shouldRotate) {
              // Rotation: Raum hat zu lange geheizt, pausieren für andere
              // WICHTIG: 15°C - deutlich unter Raumtemperatur damit Thermostat GARANTIERT stoppt
              action = 'deactivate';
              targetTemp = 15;  // 15°C - überwindet Thermostat-Hysterese (~0.5°C)
              solarLimitTemp = null;
              reasoning = `🔄 ${budgetStatus.reason} → 15°C (Rotation-Stopp)`;
              console.log(`[PV-Automation] ${room.name}: ROTATION - ${reasoning}`);
              
              // Tracking aktualisieren
              await supabase
                .from('rooms')
                .update({ 
                  last_heating_end: now.toISOString(),
                  heating_paused_reason: 'rotation'
                })
                .eq('id', room.id);
            } else if (!budgetStatus.allowedToHeat) {
              // Budget reicht nicht - auf 15°C setzen damit Thermostat GARANTIERT stoppt
              // 15°C ist deutlich unter den aktuellen Raumtemperaturen (18-20°C)
              action = 'deactivate';
              targetTemp = 15;  // 15°C - überwindet Thermostat-Hysterese
              solarLimitTemp = null;
              reasoning = `⏸️ ${budgetStatus.reason} → 15°C (Budget-Stopp)`;
              console.log(`[PV-Automation] ${room.name}: BUDGET-PAUSE - ${reasoning}`);
              
              // Tracking aktualisieren
              await supabase
                .from('rooms')
                .update({ heating_paused_reason: 'budget' })
                .eq('id', room.id);
            } else if (budgetStatus.allowedToHeat) {
              // Heizen erlaubt - auf comfortTemp setzen für optimale PV-Nutzung!
              action = 'activate';
              targetTemp = comfortTemp;  // 21°C - nutze PV voll aus
              solarLimitTemp = null;
              reasoning = `☀️ PV-Heizen: ${comfortTemp}°C (Budget: ${budgetStatus.reason})`;
              console.log(`[PV-Automation] ${room.name}: PV-HEIZEN - ${reasoning}`);
              
              // Tracking starten
              await supabase
                .from('rooms')
                .update({ 
                  last_heating_start: room.is_heating ? room.last_heating_start : now.toISOString(),
                  heating_paused_reason: null
                })
                .eq('id', room.id);
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
        
        // WICHTIG: Bei JEDER Temperatur-Reduktion API aufrufen (für sequenzielles Heizen)
        // Prüfe nur ob neue Temp niedriger ist - unabhängig von action!
        // Das behebt das Problem: 18°C -> 15°C wurde geskippt weil 18 < 18-0.5 = false
        const needsToReduceTemp = newTargetTemp < currentTargetTemp - 0.5;
        const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp;
        
        if (shouldSkip) {
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
        
        // Log wenn wir einen Force-Push machen
        if (needsToReduceTemp) {
          console.log(`[PV-Automation] ${room.name}: FORCE-PUSH - reducing from ${currentTargetTemp}°C to ${newTargetTemp}°C (action: ${action})`);
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
          ml_features: latestMlFeatures.find(f => f.room_id === room.id) || null,
          room_power_w: room.calculated_power_w || room.heating_power_w || (room.floor_area_m2 ? room.floor_area_m2 * 60 : 800),
          night_temp: room.night_temp || settings.night_temp || 17
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
        let tuyaError: { errorType?: string; errorMessage?: string } | null = null;

        if (action === 'activate') {
          if (room.tuya_device_id) {
            const result = await setTemperatureByMode(supabase, tuyaAccessId, tuyaAccessSecret, room.tuya_device_id, room.id, targetTemp, controlMode);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            tuyaApiCalls++;
          }

          if (success || !room.tuya_device_id) {
            // Clear any existing errors for this room on success
            await supabase
              .from('api_errors')
              .update({ resolved_at: now.toISOString() })
              .eq('room_id', room.id)
              .is('resolved_at', null);

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
          } else if (tuyaError) {
            // Log API error
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              room_id: room.id,
              room_name: room.name,
              error_type: tuyaError.errorType || 'tuya_api',
              error_message: tuyaError.errorMessage?.slice(0, 500),
              device_id: room.tuya_device_id,
            });
            console.error(`[PV-Automation] Tuya API error for ${room.name}: ${tuyaError.errorMessage}`);
          }

        } else if (action === 'deactivate') {
          // Verwende die bereits berechnete targetTemp (kann nightTemp oder ecoTemp sein)
          // Fallback auf eco_temp nur wenn targetTemp nicht gesetzt wurde
          const finalTemp = targetTemp || room.eco_temp || settings?.eco_temp || 18;
          
          console.log(`[PV-Automation] ${room.name} deactivate: Setze ${finalTemp}°C (targetTemp=${targetTemp}, nightTemp=${room.night_temp || settings?.night_temp})`);

          if (room.tuya_device_id) {
            const result = await setTemperatureByMode(supabase, tuyaAccessId, tuyaAccessSecret, room.tuya_device_id, room.id, finalTemp, controlMode);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            tuyaApiCalls++;
          }

          if (success || !room.tuya_device_id) {
            // Clear any existing errors for this room on success
            await supabase
              .from('api_errors')
              .update({ resolved_at: now.toISOString() })
              .eq('room_id', room.id)
              .is('resolved_at', null);
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
          } else if (tuyaError) {
            // Log API error
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              room_id: room.id,
              room_name: room.name,
              error_type: tuyaError.errorType || 'tuya_api',
              error_message: tuyaError.errorMessage?.slice(0, 500),
              device_id: room.tuya_device_id,
            });
            console.error(`[PV-Automation] Tuya API error for ${room.name}: ${tuyaError.errorMessage}`);
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
