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

// (isMorningWaitPeriod entfernt — Thermostate regeln passiven Solargewinn selbst, alle Räume gleich behandelt)

// (isOptimalHeatingTime entfernt — normale Tag-Logik übernimmt)

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authentication: Validate JWT token or known key
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = authHeader.replace('Bearer ', '');

  // Quick check: known keys (service_role, anon, publishable)
  const knownKeys = [serviceRoleKey, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
  let isAuthorized = knownKeys.includes(token);

  // If not a known key, try to decode JWT and check role
  if (!isAuthorized) {
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        const role = payload.role || payload.aud;
        isAuthorized = ['anon', 'authenticated', 'service_role'].includes(role);
        if (!isAuthorized) {
          console.error(`[pv-automation] Auth rejected: role=${role}, sub=${!!payload.sub}`);
        }
      }
    } catch (e) {
      console.error(`[pv-automation] JWT decode failed: ${e}`);
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseKey = serviceRoleKey;
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
    if ((path === '/check' || path === '') && req.method === 'POST') {
      console.log('[PV-Automation] Starting ML-based check...');

      // Load control mode FIRST
      const { data: modeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      let controlMode = (modeSetting?.value as { mode?: string })?.mode || 'cloud';
      console.log(`[PV-Automation] Control mode: ${controlMode}`);

      // ============= TUYA API QUOTA + KANAL-GESUNDHEIT =============
      let quotaData: { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string; last_sync_at: string | null } | null = null;
      let quotaExhausted = false;
      let pvPriorityMode = false; // PV-Überschuss-Priorität bei Quota-Knappheit
      let pvPriorityCalls = 0; // Zähler für PV-Priority-Calls (max 5)
      const PV_PRIORITY_MAX_CALLS = 3;
      let localServiceActive = true;
      let lastLocalExec: string | null = null;
      let forcedLocalFallback = false;

      const checkLocalServiceActive = async (): Promise<boolean> => {
        const { data: recentLocalExec } = await supabase
          .from('thermostat_commands')
          .select('executed_at')
          .eq('status', 'executed')
          .order('executed_at', { ascending: false })
          .limit(1);

        lastLocalExec = recentLocalExec?.[0]?.executed_at || null;
        return !!(lastLocalExec && (Date.now() - new Date(lastLocalExec).getTime()) < 15 * 60 * 1000);
      };

      // NOTE: Auto-switch to local mode is DISABLED - local service is not yet functional.
      // The mode must be changed manually by the user in settings.
      const persistLocalModeIfNeeded = async (reason: string) => {
        console.log(`[PV-Automation] ⚠️ Quota-Problem erkannt (${reason}), aber Auto-Switch auf LOCAL ist deaktiviert. Bleibe bei aktuellem Modus.`);
      };

      const queueLocalTemperatureCommand = async (
        roomId: string,
        temperature: number
      ): Promise<{ queued: boolean; alreadyQueued: boolean; error?: string }> => {
        const { data: pendingCommand } = await supabase
          .from('thermostat_commands')
          .select('id, value')
          .eq('room_id', roomId)
          .eq('command', 'set_temp')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const pendingValue = Number(pendingCommand?.value ?? NaN);
        if (pendingCommand?.id && Number.isFinite(pendingValue) && Math.abs(pendingValue - temperature) < 0.1) {
          return { queued: true, alreadyQueued: true };
        }

        const { error } = await supabase.from('thermostat_commands').insert({
          room_id: roomId,
          command: 'set_temp',
          value: temperature,
          status: 'pending',
        });

        if (error) {
          console.error('[PV-Automation] Local command insert error:', error);
          return { queued: false, alreadyQueued: false, error: error.message };
        }

        return { queued: true, alreadyQueued: false };
      };

      if (controlMode === 'cloud') {
        const { data: quotaSetting } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'tuya_api_quota')
          .maybeSingle();

         if (quotaSetting?.value) {
          quotaData = quotaSetting.value as typeof quotaData;
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);

          if (quotaData!.month !== currentMonth) {
            quotaData!.calls_this_month = 0;
            quotaData!.month = currentMonth;
          }
          if (quotaData!.today !== wienDate) {
            quotaData!.calls_today = 0;
            quotaData!.today = wienDate;
          }

          const monthlyLimit = quotaData!.monthly_limit || 900;
          const configuredDailyLimit = quotaData!.daily_limit || 33;
          
          // DYNAMISCHES TAGESBUDGET: Verbleibendes Monatsbudget / verbleibende Tage
          const now2 = new Date();
          const daysInMonth = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
          const wienDay = parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', day: 'numeric' }).format(now2));
          const remainingDays = Math.max(1, daysInMonth - wienDay + 1); // inkl. heute
          const remainingMonthlyBudget = Math.max(0, monthlyLimit - quotaData!.calls_this_month);
          const dynamicDailyLimit = Math.max(1, Math.floor(remainingMonthlyBudget / remainingDays));
          
          // Verwende das kleinere von konfiguriertem und dynamischem Limit
          const dailyLimit = Math.min(configuredDailyLimit, dynamicDailyLimit);
          
          // Reserve: 2 Calls für Notfall-Frostschutz freihalten
          const effectiveDailyLimit = Math.max(1, dailyLimit - 2);

          // Plausibilitäts-Check: Tages-Counter
          if (quotaData!.calls_today > configuredDailyLimit * 2) {
            console.log(`[PV-Automation] ⚠️ Tages-Counter unplausibel hoch (${quotaData!.calls_today}/${configuredDailyLimit}) - reset auf ${configuredDailyLimit}`);
            quotaData!.calls_today = configuredDailyLimit;
          }

          // Plausibilitäts-Check: Monats-Counter
          if (quotaData!.calls_this_month > monthlyLimit * 2) {
            console.log(`[PV-Automation] ⚠️ Monats-Counter unplausibel hoch (${quotaData!.calls_this_month}/${monthlyLimit}) - reset auf ${monthlyLimit}`);
            quotaData!.calls_this_month = monthlyLimit;
          }

          if (quotaData!.calls_this_month >= monthlyLimit || quotaData!.calls_today >= effectiveDailyLimit) {
            quotaExhausted = true;
            console.log(`[PV-Automation] ⚠️ Quota erschöpft (${quotaData!.calls_today}/${dailyLimit} heute [dynamisch: ${dynamicDailyLimit}, konfig: ${configuredDailyLimit}], ${quotaData!.calls_this_month}/${monthlyLimit} monatlich, ${remainingDays} Tage übrig)`);
          } else {
            console.log(`[PV-Automation] Quota: ${quotaData!.calls_today}/${dailyLimit} heute [dynamisch: ${dynamicDailyLimit}], ${quotaData!.calls_this_month}/${monthlyLimit} monatlich, ${remainingDays} Tage übrig`);
          }
        }

        // Realitäts-Check: echte Quota-Fehler loggen (aber KEIN Auto-Switch)
        const { data: recentQuotaErrors } = await supabase
          .from('api_errors')
          .select('id')
          .eq('source', 'pv-automation')
          .eq('error_type', 'tuya_api')
          .is('resolved_at', null)
          .gte('created_at', new Date(Date.now() - 90 * 60 * 1000).toISOString())
          .ilike('error_message', '%quota%')
          .limit(1);

        if (recentQuotaErrors && recentQuotaErrors.length > 0) {
          quotaExhausted = true;
          console.log('[PV-Automation] ⚠️ Quota laut API-Fehlern erschöpft - Auto-Switch auf LOCAL ist deaktiviert, bleibe bei Cloud');
        }
      }

      if (controlMode === 'local' || quotaExhausted) {
        localServiceActive = await checkLocalServiceActive();

        if (localServiceActive) {
          await supabase
            .from('api_errors')
            .update({ resolved_at: new Date().toISOString() })
            .eq('source', 'pv-automation')
            .eq('error_type', 'no_control_channel')
            .is('resolved_at', null);
        } else {
          const { data: recentNoControl } = await supabase
            .from('api_errors')
            .select('id')
            .eq('source', 'pv-automation')
            .eq('error_type', 'no_control_channel')
            .is('resolved_at', null)
            .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
            .limit(1);

          if (!recentNoControl || recentNoControl.length === 0) {
            await supabase.from('api_errors').insert({
              source: 'pv-automation',
              error_type: 'no_control_channel',
              error_message: `Lokaler Service nicht aktiv. Letzter ausgeführter lokaler Befehl: ${lastLocalExec || 'nie'}`,
              error_code: 'NO_CONTROL',
            });
          }

          console.log(`[PV-Automation] ⛔ Kein Steuerkanal verfügbar (lastLocalExec=${lastLocalExec || 'none'})`);
        }
      }

      // Helper: Mode-aware temperature setting
      async function setTemperatureForMode(
        deviceId: string,
        roomId: string,
        temperature: number
      ): Promise<TuyaResult> {
        if (controlMode === 'local') {
          const queued = await queueLocalTemperatureCommand(roomId, temperature);
          if (!queued.queued) {
            return { success: false, errorType: 'db_error', errorMessage: queued.error || 'Lokales Queueing fehlgeschlagen' };
          }

          if (!localServiceActive) {
            console.log(`[PV-Automation] Local command vorgemerkt (Service offline): room=${roomId} temp=${temperature}°C`);
            return {
              success: false,
              errorType: 'local_service_offline',
              errorMessage: queued.alreadyQueued
                ? 'Lokaler Service offline - Befehl bereits wartend'
                : 'Lokaler Service offline - Befehl wartend vorgemerkt',
            };
          }

          console.log(`[PV-Automation] Local command queued: room=${roomId} temp=${temperature}°C${queued.alreadyQueued ? ' (bereits vorhanden)' : ''}`);
          return { success: true };
        }
        // QUOTA-GATE: Block cloud API calls when quota is exhausted
        // EXCEPTION: PV-Priority-Modus erlaubt begrenzte Calls bei hohem PV-Überschuss
        if (quotaExhausted && !pvPriorityMode) {
          console.log(`[PV-Automation] ⛔ QUOTA-GATE: Cloud API call blocked for device ${deviceId} → ${temperature}°C`);
          return { success: false, errorType: 'quota_exhausted', errorMessage: 'Tuya API Quota erschöpft - kein Cloud-Call möglich' };
        }
        if (quotaExhausted && pvPriorityMode) {
          // Nur Aufheiz-Calls (>= eco_temp) zählen gegen PV-Priority-Limit
          const nightTempRef = settings?.night_temp || 17;
          const isHeatingCall = temperature > nightTempRef + 0.5;
          if (isHeatingCall) {
            if (pvPriorityCalls >= PV_PRIORITY_MAX_CALLS) {
              console.log(`[PV-Automation] ⛔ PV-Priority-Limit erreicht (${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS})`);
              return { success: false, errorType: 'quota_exhausted', errorMessage: 'PV-Priority-Limit erreicht' };
            }
            pvPriorityCalls++;
            console.log(`[PV-Automation] ⚡ PV-Priority-Call ${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS}: ${deviceId} → ${temperature}°C (Aufheizen)`);
          } else {
            console.log(`[PV-Automation] 🔽 PV-Priority-Deaktivierung (kein Limit): ${deviceId} → ${temperature}°C`);
          }
        }
        if (!tuyaAccessId || !tuyaAccessSecret) {
          return { success: false, errorType: 'config', errorMessage: 'Tuya credentials not configured' };
        }
        return await setDeviceTemperature(tuyaAccessId, tuyaAccessSecret, deviceId, temperature);
      }

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
        const nightHeatingMode = settings?.night_heating_mode || 'frost_only';
        console.log(`[PV-Automation] Night mode active (${wienTime}), mode: ${nightHeatingMode}`);
        
        // Load all rooms with Tuya devices
        const { data: allRooms } = await supabase
          .from('rooms')
          .select('id, name, tuya_device_id, target_temp, night_temp, pv_auto_active, heating_paused_reason')
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

        const nightResults: { roomId: string; roomName: string; success: boolean; action: string; error?: string }[] = [];

        if (nightHeatingMode === 'frost_only') {
          // FROST_ONLY: Thermostate auf Frostschutz (5°C) setzen → kein aktives Heizen
          const FROST_TEMP = 5;
          
          const roomsNeedingOff = allRooms.filter(r => {
            const currentTarget = Number(r.target_temp) || 0;
            return currentTarget > FROST_TEMP + 1; // Noch nicht auf Frostschutz
          });

          if (roomsNeedingOff.length === 0) {
            console.log(`[PV-Automation] Night frost_only: all ${allRooms.length} thermostats already at frost protection`);
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Nachtmodus aktiv (${wienTime}) - alle Thermostate auf Frostschutz (${FROST_TEMP}°C)`,
              nightMode: true, nightHeatingMode,
              thermostatsChecked: allRooms.length,
              results: [] 
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          console.log(`[PV-Automation] Night frost_only: ${roomsNeedingOff.length}/${allRooms.length} rooms → Frostschutz ${FROST_TEMP}°C`);

          for (const room of roomsNeedingOff) {
            console.log(`[PV-Automation] Night: ${room.name} → ${FROST_TEMP}°C (was ${room.target_temp}°C)`);
            
            const result = await setTemperatureForMode(
              room.tuya_device_id!,
              room.id,
              FROST_TEMP
            );

            if (result.success) {
              await supabase.from('rooms').update({
                target_temp: FROST_TEMP,
                pv_auto_active: false,
                is_heating: false,
                heating_paused_reason: 'night_frost_only',
                last_auto_change: new Date().toISOString(),
                last_thermostat_sync: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq('id', room.id);
              
              nightResults.push({ roomId: room.id, roomName: room.name, success: true, action: `frost_${FROST_TEMP}°C` });
            } else {
              console.error(`[PV-Automation] Night frost: Failed ${room.name}: ${result.errorMessage}`);
              nightResults.push({ roomId: room.id, roomName: room.name, success: false, action: 'frost_failed', error: result.errorMessage });
            }
          }

        } else {
          // MAINTAIN: Bisheriges Verhalten – night_temp halten
          const globalNightTemp = settings?.night_temp || 17;
          console.log(`[PV-Automation] Night maintain: globalNightTemp=${globalNightTemp}°C`);
          
          const roomsNeedingAdjustment = allRooms.filter(r => {
            const currentTarget = Number(r.target_temp) || 0;
            const nightTarget = r.night_temp || globalNightTemp;
            return Math.abs(currentTarget - nightTarget) >= 0.5;
          });

          if (roomsNeedingAdjustment.length === 0) {
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Nachtmodus aktiv (${wienTime}) - alle ${allRooms.length} Thermostate bereits auf Nachttemperatur`,
              nightMode: true, nightHeatingMode,
              thermostatsChecked: allRooms.length,
              results: [] 
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          for (const room of roomsNeedingAdjustment) {
            const nightTarget = room.night_temp || globalNightTemp;
            console.log(`[PV-Automation] Night maintain: ${room.name} → ${nightTarget}°C (was ${room.target_temp}°C)`);
            
            const result = await setTemperatureForMode(
              room.tuya_device_id!,
              room.id,
              nightTarget
            );

            if (result.success) {
              await supabase.from('rooms').update({
                target_temp: nightTarget,
                pv_auto_active: false,
                heating_paused_reason: null,
                last_auto_change: new Date().toISOString(),
                last_thermostat_sync: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq('id', room.id);
              
              nightResults.push({ roomId: room.id, roomName: room.name, success: true, action: `maintain_${nightTarget}°C` });
            } else {
              nightResults.push({ roomId: room.id, roomName: room.name, success: false, action: 'maintain_failed', error: result.errorMessage });
            }
          }
        }

        const successCount = nightResults.filter(r => r.success).length;
        
        // Quota tracking für Nacht-Befehle
        if (quotaData && controlMode === 'cloud' && successCount > 0) {
          quotaData.calls_this_month += successCount;
          quotaData.calls_today += successCount;
          await supabase.from('system_settings')
            .update({ value: quotaData, updated_at: new Date().toISOString() })
            .eq('key', 'tuya_api_quota');
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Nachtmodus aktiv (${wienTime}, ${nightHeatingMode}) - ${successCount} Thermostate angepasst`,
          nightMode: true, nightHeatingMode,
          adjusted: successCount,
          total: allRooms.length,
          results: nightResults,
          quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
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
      const gridExportForPriority = Math.max(0, -reading.power_io);

      // ============= PV-PRIORITY-MODUS =============
      // Bei erschöpfter Quota ABER hohem PV-Überschuss: begrenzte API-Calls erlauben
      // Damit wird PV-Potenzial genutzt statt Strom ins Netz zu verschenken
      if (quotaExhausted && controlMode === 'cloud') {
        if (gridExportForPriority > 1500 && batterySoc >= 90) {
          pvPriorityMode = true;
          console.log(`[PV-Automation] ⚡ PV-PRIORITY-MODUS aktiviert: ${gridExportForPriority}W Export, ${batterySoc}% Batterie → max ${PV_PRIORITY_MAX_CALLS} Calls erlaubt trotz Quota`);
        } else {
          // Quota erschöpft und kein PV-Priority → sofort zurückkehren ohne DB-Writes
          console.log(`[PV-Automation] ⚠️ Quota erschöpft, kein PV-Priority (Export ${gridExportForPriority}W < 1500W oder SOC ${batterySoc}% < 90%) → SOFORT-RETURN`);
          return new Response(JSON.stringify({
            success: true,
            message: 'Quota erschöpft - übersprungen (kein PV-Priority)',
            quotaExhausted: true,
            pvPriorityMode: false,
            tuyaApiCalls: 0,
            quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      const minBatterySoc = settings?.min_battery_soc || 20;
      const thresholdOn = settings?.pv_surplus_threshold_on || DEFAULT_PV_SURPLUS_THRESHOLD_ON;
      const thresholdOff = settings?.pv_surplus_threshold_off || DEFAULT_PV_SURPLUS_THRESHOLD_OFF;
      const minSwitchIntervalMs = (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN) * 60 * 1000;

      // 3. Load ALL automated rooms - not just those with PV heating
      // This ensures rooms with pv_auto_enabled=false still get:
      // - Night mode (night_temp)
      // - Budget pause (15°C when PV is low)
      // - But NO active PV heating to comfort temp
      let { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('automation_enabled', true)
        .not('tuya_device_id', 'is', null);

      if (roomsError || !rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No rooms with PV automation', results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ============= PRE-SYNC: Frische Thermostatdaten vor Automationsrunde =============
      // Throttle: nur alle 15 Minuten syncen um Tuya API Quota zu schonen
      let syncFailed = false;
      const shouldSync = (() => {
        if (controlMode !== 'cloud' || !tuyaAccessId || !tuyaAccessSecret) return false;
        if (quotaExhausted) return false; // Skip pre-sync when quota exhausted
        if (!quotaData?.last_sync_at) return true;
        const lastSync = new Date(quotaData.last_sync_at).getTime();
        const minutesSinceSync = (Date.now() - lastSync) / (1000 * 60);
        return minutesSinceSync >= 120; // 120 Minuten statt 30 → drastische Quota-Ersparnis
      })();

      if (shouldSync) {
        try {
          console.log(`[PV-Automation] Pre-sync: Lade frische Thermostatdaten für ${rooms.length} Räume...`);
          const syncResponse = await fetch(`${supabaseUrl}/functions/v1/tuya-control/sync-all`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          });
          
          if (syncResponse.ok) {
            const syncResult = await syncResponse.json();
            console.log(`[PV-Automation] Pre-sync erfolgreich: ${syncResult.results?.length || 0} Räume synchronisiert`);
            
            // Quota: Sync = 2 API calls (Token-Refresh + Batch-Status)
            if (quotaData) {
              quotaData.calls_this_month += 2;
              quotaData.calls_today += 2;
              quotaData.last_sync_at = new Date().toISOString();
              // Re-check quota after pre-sync
              const effectiveDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
              if (quotaData.calls_today >= effectiveDL || quotaData.calls_this_month >= (quotaData.monthly_limit || 900)) {
                quotaExhausted = true;
                console.log(`[PV-Automation] ⚠️ Quota nach Pre-Sync erschöpft (${quotaData.calls_today}/${effectiveDL} heute, ${quotaData.calls_this_month}/${quotaData.monthly_limit || 900} monatlich)`);
              }
            }
            
            // Räume neu laden mit frischen Daten
            const { data: freshRooms, error: freshError } = await supabase
              .from('rooms')
              .select('*')
              .eq('automation_enabled', true)
              .not('tuya_device_id', 'is', null);
            
            if (!freshError && freshRooms && freshRooms.length > 0) {
              rooms = freshRooms;
              console.log(`[PV-Automation] Räume neu geladen nach Pre-sync`);
            }
          } else {
            console.warn(`[PV-Automation] Pre-sync fehlgeschlagen (${syncResponse.status}) - verwende DB-Daten, nur Reduktionen/Stops erlaubt`);
            syncFailed = true;
          }
        } catch (syncError) {
          console.warn(`[PV-Automation] Pre-sync Fehler: ${syncError} - verwende DB-Daten, nur Reduktionen/Stops erlaubt`);
          syncFailed = true;
        }
      } else if (controlMode === 'cloud') {
        console.log(`[PV-Automation] Pre-sync übersprungen (Throttle: nächster Sync in ${quotaData?.last_sync_at ? Math.max(0, 120 - Math.round((Date.now() - new Date(quotaData.last_sync_at).getTime()) / 60000)) : '?'} Min)`);
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

      // 7. Load PV forecast for today (with hourly_watts for tracking)
      // Wien-Datum verwenden (nicht UTC!) — zwischen 00:00-01:00 UTC wäre sonst das gestrige Datum
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      const { data: pvForecast } = await supabase
        .from('pv_forecasts')
        .select('expected_kwh, hourly_watts')
        .eq('date', today)
        .single();

      const expectedPvKwh = pvForecast?.expected_kwh || 0;
      const hourlyWatts = (pvForecast?.hourly_watts || {}) as Record<string, number>;

      // ============= PV-BOOST: ENERGIEBUDGET-BERECHNUNG =============
      const boostDelta = settings?.pv_boost_temp_delta || 2;
      const batteryCapacity = settings?.battery_capacity_kwh || 13.8;
      const batteryNeedKwh = batteryCapacity * Math.max(0, 1 - (batterySoc / 100));
      const hotwaterKwh = (settings?.hotwater_enabled !== false) 
        ? ((settings?.hotwater_power_w || 2800) * 4 / 1000) // ~4h Laufzeit
        : 0;
      const carKwh = (settings?.car_charging_enabled === true) ? 10 : 0;
      const availableHeatingKwh = Math.max(0, expectedPvKwh - batteryNeedKwh - hotwaterKwh - carKwh);

      // Prognose-Korrektur: Vergleiche bisherige tatsächliche PV-Produktion mit Prognose
      let forecastAccuracy = 1.0; // 1.0 = perfekt
      const { wienHour: currentHourForForecast } = isNightTime('22:00', '06:00');
      if (currentHourForForecast >= 8 && Object.keys(hourlyWatts).length > 0) {
        // Summe der prognostizierten Wh bis zur aktuellen Stunde
        let forecastSoFarWh = 0;
        for (let h = 6; h < currentHourForForecast; h++) {
          const key = String(h);
          forecastSoFarWh += (hourlyWatts[key] || 0);
        }
        
        if (forecastSoFarWh > 0) {
          // Tatsächliche Produktion aus energy_readings (energy_out = PV-Produktion)
          const todayStart = `${today}T06:00:00`;
          const { data: todayReadings } = await supabase
            .from('energy_readings')
            .select('pv_power, timestamp')
            .gte('timestamp', todayStart)
            .order('timestamp', { ascending: true });
          
          if (todayReadings && todayReadings.length > 2) {
            // Approximate actual kWh from pv_power samples (avg * hours)
            const avgPvW = todayReadings.reduce((sum, r) => sum + (r.pv_power || 0), 0) / todayReadings.length;
            const hoursElapsed = Math.max(1, currentHourForForecast - 6);
            const actualWh = avgPvW * hoursElapsed;
            forecastAccuracy = Math.min(2.0, actualWh / forecastSoFarWh);
          }
        }
      }

      const boostAllowed = availableHeatingKwh > 3 && forecastAccuracy >= 0.7;
      console.log(`[PV-Automation] PV-Boost: Budget=${availableHeatingKwh.toFixed(1)}kWh (Prognose=${expectedPvKwh}kWh - Batterie=${batteryNeedKwh.toFixed(1)} - WW=${hotwaterKwh} - Auto=${carKwh}), Prognose-Genauigkeit=${(forecastAccuracy*100).toFixed(0)}%, Boost=${boostAllowed ? 'ERLAUBT' : 'GESPERRT'}`);
      const pvPower = reading.pv_power || 0;

      // (Solar-Gain-Erkennung entfernt — Thermostate regeln passiven Solargewinn selbst)

      // Calculate grid export (negative power_io means export)
      const gridExport = reading.power_io < 0 ? -reading.power_io : 0;

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
          // PV-Optimiert: Budget = gridExport + Leistung bereits heizender Räume + Toleranz
          // Begründung: gridExport zeigt nur den REST-Export. Räume die bereits heizen
          // verbrauchen PV-Strom der nicht mehr im Export erscheint. Das tatsächliche
          // PV-Budget für Heizung ist gridExport + was bereits geheizt wird.
          budgetMode = 'pv_optimized';
          const currentlyHeatingPower = rooms
            .filter(r => r.is_heating)
            .reduce((sum, r) => sum + (r.calculated_power_w || r.heating_power_w || 800), 0);
          const dynamicTolerance = Math.max(powerBudgetTolerance, Math.round(gridExport * 0.20));
          
          // Basis-Budget: gridExport + bereits heizend + Toleranz
          let baseBudget = gridExport + currentlyHeatingPower + dynamicTolerance;
          
          // PV-Prognose-Bonus: Bei guter Vorhersage mehr Budget für Eco
          // > 15 kWh: alle Räume sollen Eco bekommen (großes Budget)
          // > 8 kWh: mittleres Extra-Budget
          // < 8 kWh: nur gridExport nutzen (kein Bonus)
          let forecastBonus = 0;
          if (expectedPvKwh >= 15) {
            forecastBonus = 3000; // Viel PV erwartet → großzügig heizen
          } else if (expectedPvKwh >= 8) {
            forecastBonus = 1500; // Mittlere PV → moderater Bonus
          }
          
          availableBudget = Math.max(0, baseBudget + forecastBonus);
          console.log(`[PV-Automation] PV-Budget: gridExport ${gridExport}W + heizend ${currentlyHeatingPower}W + Toleranz ${dynamicTolerance}W + Prognose-Bonus ${forecastBonus}W (${expectedPvKwh} kWh) = ${availableBudget}W`);
        } else if (gridExport > 200) {
          // Wenig PV-Produktion ABER gridExport vorhanden
          // → gridExport für Eco nutzen (z.B. Batterie speist ins Netz)
          budgetMode = 'grid_sequential';
          availableBudget = Math.max(0, gridExport);
          console.log(`[PV-Automation] Wenig PV (${pvPower}W) aber gridExport ${gridExport}W → Budget für Eco: ${availableBudget}W`);
        } else {
          // KEIN PV und kein gridExport → kein Heizen
          budgetMode = 'grid_sequential';
          availableBudget = 0;
          console.log(`[PV-Automation] Wenig PV (${pvPower}W) und kein gridExport → KEIN Heizen, Budget=0W`);
        }
      }
      
      // Räume nach Priorität, Effizienz und Temperatur-Defizit sortieren
      // ML-Features (energy_per_degree_wh) werden für Effizienz-Sortierung genutzt
      const now = new Date();
      const roomsWithPriority = rooms.map(room => {
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const comfortTemp = room.comfort_temp || settings?.comfort_temp || 21;
        const currentTemp = room.current_temp || ecoTemp;
        const tempDeficit = ecoTemp - currentTemp;
        const heatingPower = room.calculated_power_w || room.heating_power_w || 800;
        
        // ML-Features: energy_per_degree_wh für diesen Raum nachschlagen
        const mlFeature = latestMlFeatures.find((f: any) => f.room_id === room.id);
        const energyPerDegreeWh = (mlFeature as any)?.energy_per_degree_wh || null;
        
        // Geschätzte Dauer bis Ziel (in Minuten)
        const tempToTarget = Math.max(0, comfortTemp - currentTemp);
        const estimatedDurationMin = energyPerDegreeWh && heatingPower > 0
          ? (energyPerDegreeWh * tempToTarget) / heatingPower * 60
          : null;
        const estimatedEnergyWh = energyPerDegreeWh
          ? energyPerDegreeWh * tempToTarget
          : null;
        
        // Wartezeit seit letzter Heizung
        const lastEnd = room.last_heating_end ? new Date(room.last_heating_end) : null;
        const waitTimeMinutes = lastEnd ? (now.getTime() - lastEnd.getTime()) / (1000 * 60) : 999;
        
        // Aktuelle Heizdauer
        const lastStart = room.last_heating_start ? new Date(room.last_heating_start) : null;
        const isCurrentlyHeating = room.is_heating === true;
        const heatingDurationMinutes = isCurrentlyHeating && lastStart ? 
          (now.getTime() - lastStart.getTime()) / (1000 * 60) : 0;
        
        // Logging: Effizienz-Info pro Raum
        if (energyPerDegreeWh && tempToTarget > 0) {
          console.log(`[PV-Automation] ${room.name}: braucht ~${estimatedEnergyWh?.toFixed(0)} Wh für +${tempToTarget.toFixed(1)}°C (${energyPerDegreeWh.toFixed(0)} Wh/°C), geschätzte Dauer: ${estimatedDurationMin?.toFixed(0)} Min bei ${heatingPower}W`);
        }
        
        return {
          room,
          priority: room.priority || 2,
          tempDeficit,
          heatingPower,
          energyPerDegreeWh,
          estimatedDurationMin,
          waitTimeMinutes,
          isCurrentlyHeating,
          heatingDurationMinutes
        };
      });
      
      // Sortierung: 1. Priorität, 2. Temperatur-Defizit (>0.5°C Unterschied), 
      // 3. Effizienz (niedrigeres energy_per_degree_wh = schneller fertig → bevorzugt),
      // 4. Wartezeit (längste zuerst als Tiebreaker)
      roomsWithPriority.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (Math.abs(a.tempDeficit - b.tempDeficit) > 0.5) return b.tempDeficit - a.tempDeficit;
        // Effizienz: Räume mit bekanntem energy_per_degree_wh vor unbekannten,
        // dann niedrigere Wh/°C zuerst (schneller aufgeheizt → gibt Budget frei)
        const aEff = a.energyPerDegreeWh || 99999;
        const bEff = b.energyPerDegreeWh || 99999;
        if (Math.abs(aEff - bEff) > 100) return aEff - bEff;
        return b.waitTimeMinutes - a.waitTimeMinutes;
      });
      
      // Sortierungs-Ergebnis loggen
      const heatingOrder = roomsWithPriority.map((rp, idx) => 
        `  ${idx + 1}. ${rp.room.name} (Prio ${rp.priority}, Defizit ${rp.tempDeficit.toFixed(1)}°C, ${rp.energyPerDegreeWh ? rp.energyPerDegreeWh + ' Wh/°C' : 'keine ML-Daten'}, ${rp.heatingPower}W, ${rp.isCurrentlyHeating ? 'HEIZT' : 'wartet ' + Math.round(rp.waitTimeMinutes) + ' Min'})`
      ).join('\n');
      console.log(`[PV-Automation] Heiz-Reihenfolge (${roomsWithPriority.length} Räume):\n${heatingOrder}`);
      
      // Tracking für Budget-Verbrauch
      let usedBudget = 0;
      const roomBudgetStatus = new Map<string, { 
        allowedToHeat: boolean; 
        reason: string; 
        shouldRotate: boolean;
        targetLevel: 'eco' | 'comfort' | 'super_comfort' | 'none';
      }>();
      
      // ============= 2-PHASEN BUDGET-ZUWEISUNG =============
      // Phase 1: Eco-Runde — alle Räume unter eco auf eco bringen
      // Phase 2: Komfort-Runde — mit Restbudget Räume auf komfort bringen
      // Keine Batterie-Bedingung! Einzige Bedingung: Reicht das PV-Budget?
      
      // Erst Rotation/Pause prüfen für alle Räume
      for (const rp of roomsWithPriority) {
        if (rp.isCurrentlyHeating) {
          const shouldRotate = rp.heatingDurationMinutes >= roomRotationMinutes && 
            roomsWithPriority.some(other => {
              if (other.isCurrentlyHeating || other.tempDeficit <= 0.5 || other.waitTimeMinutes < minRoomPauseMinutes) return false;
              if (other.priority < rp.priority) return true;
              if (other.priority === rp.priority) {
                const otherEff = other.energyPerDegreeWh || 99999;
                const rpEff = rp.energyPerDegreeWh || 99999;
                return otherEff <= rpEff;
              }
              return false;
            });
          
          if (shouldRotate) {
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: false,
              reason: `Rotation nach ${Math.round(rp.heatingDurationMinutes)} Min`,
              shouldRotate: true,
              targetLevel: 'none'
            });
            continue;
          }
        }
        
        if (!rp.isCurrentlyHeating && rp.waitTimeMinutes < minRoomPauseMinutes && rp.room.last_heating_end) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: false,
            reason: `Pause: noch ${Math.ceil(minRoomPauseMinutes - rp.waitTimeMinutes)} Min`,
            shouldRotate: false,
            targetLevel: 'none'
          });
        }
      }
      
      // Phase 1: ECO-Runde
      console.log(`[PV-Automation] === PHASE 1: ECO-RUNDE === Budget: ${availableBudget}W`);
      for (const rp of roomsWithPriority) {
        if (roomBudgetStatus.has(rp.room.id)) continue; // Rotation/Pause
        
        const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = rp.room.current_temp || 0;
        
        const nightTemp = rp.room.night_temp || settings?.night_temp || 17;
        // Wenn eco == night, macht Phase 1 keinen Sinn → direkt zu Phase 2 (Komfort)
        const ecoIsUseful = ecoTemp > nightTemp + 0.3;
        if (ecoIsUseful && (currentTemp < ecoTemp - 0.3 || (rp.room.target_temp != null && rp.room.target_temp <= nightTemp))) {
          // Raum braucht eco
          if (usedBudget + rp.heatingPower <= availableBudget) {
            usedBudget += rp.heatingPower;
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: true,
              reason: `Eco-Phase (${usedBudget}/${availableBudget}W)`,
              shouldRotate: false,
              targetLevel: 'eco'
            });
            console.log(`[PV-Automation] Phase 1: ${rp.room.name} → eco (${currentTemp.toFixed(1)}°C < ${ecoTemp}°C, Budget ${usedBudget}/${availableBudget}W)`);
          } else {
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: false,
              reason: `Eco kein Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W`,
              shouldRotate: false,
              targetLevel: 'none'
            });
          }
        }
        // Räume >= eco werden in Phase 1 nicht verarbeitet (kommen in Phase 2)
      }
      
      // Phase 2: KOMFORT-Runde — mit Restbudget
      const budgetAfterEco = availableBudget - usedBudget;
      console.log(`[PV-Automation] === PHASE 2: KOMFORT-RUNDE === Restbudget: ${budgetAfterEco}W`);
      for (const rp of roomsWithPriority) {
        if (roomBudgetStatus.has(rp.room.id)) {
          const existing = roomBudgetStatus.get(rp.room.id)!;
          // Räume auf Eco dürfen auf Komfort upgraded werden (kein Extra-Budget nötig)
          if (existing.targetLevel === 'eco' && existing.allowedToHeat) {
            // Weiter zur Komfort-Prüfung — Budget bereits allokiert
          } else if (existing.targetLevel !== 'none' || !existing.allowedToHeat) {
            continue;
          }
        }
        
        const comfortTemp = rp.room.comfort_temp || settings?.comfort_temp || 21;
        const ecoTemp = rp.room.eco_temp || settings?.eco_temp || 19;
        const currentTemp = rp.room.current_temp || 0;
        
        // Raum ist >= eco aber < comfort → auf comfort upgraden
        if (currentTemp >= ecoTemp - 0.3 && (currentTemp < comfortTemp - 0.3 || (rp.room.target_temp != null && rp.room.target_temp < comfortTemp))) {
          const alreadyBudgeted = roomBudgetStatus.has(rp.room.id) && 
            roomBudgetStatus.get(rp.room.id)!.targetLevel === 'eco';
          
          if (alreadyBudgeted || usedBudget + rp.heatingPower <= availableBudget) {
            if (!alreadyBudgeted) usedBudget += rp.heatingPower;
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: true,
              reason: `Komfort-Phase${alreadyBudgeted ? ' (Eco→Komfort Upgrade)' : ''} (${usedBudget}/${availableBudget}W)`,
              shouldRotate: false,
              targetLevel: 'comfort'
            });
            console.log(`[PV-Automation] Phase 2: ${rp.room.name} → komfort${alreadyBudgeted ? ' (Upgrade von Eco)' : ''} (${currentTemp.toFixed(1)}°C < ${comfortTemp}°C, Budget ${usedBudget}/${availableBudget}W)`);
          } else {
            // Kein Budget für Komfort — auf eco halten
            if (!roomBudgetStatus.has(rp.room.id)) {
              roomBudgetStatus.set(rp.room.id, {
                allowedToHeat: true,
                reason: `Eco halten (kein Komfort-Budget: ${usedBudget}+${rp.heatingPower}>${availableBudget}W)`,
                shouldRotate: false,
                targetLevel: 'eco'
              });
            }
          }
        } else if (currentTemp >= comfortTemp - 0.3) {
          // Raum ist bereits >= comfort → halten
          if (!roomBudgetStatus.has(rp.room.id)) {
            roomBudgetStatus.set(rp.room.id, {
              allowedToHeat: true,
              reason: `Komfort erreicht (${currentTemp.toFixed(1)}°C)`,
              shouldRotate: false,
              targetLevel: 'comfort'
            });
          }
        }
      }
      
      // Räume die in keiner Phase verarbeitet wurden (z.B. bereits >= eco, Budget reicht nicht für komfort)
      for (const rp of roomsWithPriority) {
        if (!roomBudgetStatus.has(rp.room.id)) {
          roomBudgetStatus.set(rp.room.id, {
            allowedToHeat: true,
            reason: `Standard (${rp.room.current_temp?.toFixed(1)}°C)`,
            shouldRotate: false,
            targetLevel: 'eco'
          });
        }
      }
      
      console.log(`[PV-Automation] Budget-Modus: ${budgetMode}, Budget: ${availableBudget}W (gridExport: ${gridExport}W), Verwendet: ${usedBudget}W`);
      console.log(`[PV-Automation] Surplus: ${surplus}W, GridExport: ${gridExport}W, SOC: ${batterySoc}%, PV: ${pvPower}W, Prognose: ${expectedPvKwh} kWh, Rooms: ${rooms.length}, ML-Features: ${latestMlFeatures.length}`);

      // ============= WARMWASSER-STATUS PRÜFEN =============
      // Warmwasser-Status und -Leistung für Budget-Berechnung
      let hotwaterActive = false;
      const hotwaterPower = settings?.hotwater_power_w || 2000;
      try {
        const { data: activeHotwater } = await supabase
          .from('consumer_logs')
          .select('id')
          .eq('consumer_type', 'hotwater')
          .eq('is_active', true)
          .limit(1);
        hotwaterActive = !!(activeHotwater && activeHotwater.length > 0);
        console.log(`[PV-Automation] Warmwasser aktiv: ${hotwaterActive} (Leistung: ${hotwaterPower}W)`);
      } catch (hwError) {
        console.warn('[PV-Automation] Warmwasser-Status nicht abrufbar:', hwError);
      }

      // Prüfe ob alle Räume >= comfort_temp sind (für Super-Comfort)
      const allRoomsAtComfort = rooms.every(r => {
        const roomComfort = r.comfort_temp || settings?.comfort_temp || 21;
        return (r.current_temp || 0) >= roomComfort - 0.3;
      });
      console.log(`[PV-Automation] Alle Räume auf Komfort: ${allRoomsAtComfort}, Batterie: ${batterySoc}%, WW aktiv: ${hotwaterActive}`);

      // 7. Call analyze-patterns with optimize_decision (THROTTLED: max alle 60 Min)
      let mlDecisions: MLDecision[] = [];
      let usedMlDecision = false;

      if (tuyaAccessId && tuyaAccessSecret) {
        const ML_CACHE_KEY = 'last_ml_cache';
        const ML_CACHE_TTL_MS = 60 * 60 * 1000; // 60 Minuten
        const SIGNIFICANT_CHANGE_THRESHOLD = 0.40; // 40% Änderung

        let useCache = false;
        try {
          // Lade ML-Cache aus system_settings
          const { data: cacheRow } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', ML_CACHE_KEY)
            .single();

          if (cacheRow?.value) {
            const cache = cacheRow.value as Record<string, unknown>;
            const cacheTime = cache.timestamp as number;
            const cacheAge = Date.now() - cacheTime;
            const cachedSoc = cache.battery_soc as number;
            const cachedPvPower = cache.pv_power as number;
            const cachedDecisions = cache.decisions as MLDecision[];

            // Prüfe signifikante Änderungen
            const socChange = cachedSoc > 0 ? Math.abs(batterySoc - cachedSoc) / cachedSoc : 1;
            const pvChange = cachedPvPower > 100 ? Math.abs(pvPower - cachedPvPower) / cachedPvPower : (pvPower > 100 ? 1 : 0);
            // PV-Abfall von >500W auf <500W ist IMMER signifikant (Gate-Grenze!)
            const pvDroppedBelowGate = cachedPvPower >= 500 && pvPower < 500;
            const significantChange = socChange > SIGNIFICANT_CHANGE_THRESHOLD || pvChange > SIGNIFICANT_CHANGE_THRESHOLD || pvDroppedBelowGate;
            if (pvDroppedBelowGate) {
              console.log(`[PV-Automation] 🔄 ML-Cache INVALIDIERT: PV fiel unter Gate-Grenze (${cachedPvPower}W → ${pvPower}W)`);
            }

            if (cacheAge < ML_CACHE_TTL_MS && !significantChange && cachedDecisions?.length > 0) {
              mlDecisions = cachedDecisions;
              usedMlDecision = true;
              useCache = true;
              console.log(`[PV-Automation] ♻️ ML-Cache verwendet (${Math.round(cacheAge / 60000)} Min alt, SOC-Δ=${(socChange*100).toFixed(0)}%, PV-Δ=${(pvChange*100).toFixed(0)}%)`);
            } else {
              console.log(`[PV-Automation] 🔄 ML-Cache ungültig: Alter=${Math.round(cacheAge / 60000)}min, SOC-Δ=${(socChange*100).toFixed(0)}%, PV-Δ=${(pvChange*100).toFixed(0)}%, significantChange=${significantChange}`);
            }
          }
        } catch (cacheError) {
          console.log(`[PV-Automation] ML-Cache nicht vorhanden, rufe AI auf`);
        }

        // Nur AI aufrufen wenn Cache ungültig
        if (!useCache) {
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

                // Speichere in ML-Cache
                try {
                  await supabase
                    .from('system_settings')
                    .upsert({
                      key: ML_CACHE_KEY,
                      value: {
                        timestamp: Date.now(),
                        battery_soc: batterySoc,
                        pv_power: pvPower,
                        decisions: mlDecisions
                      },
                      updated_at: new Date().toISOString()
                    }, { onConflict: 'key' });
                  console.log(`[PV-Automation] 💾 ML-Cache gespeichert`);
                } catch (saveError) {
                  console.warn(`[PV-Automation] ML-Cache speichern fehlgeschlagen:`, saveError);
                }
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

      // Early Return: Wenn Quota erschöpft UND kein PV-Priority-Modus, Raum-Loop überspringen
      if (quotaExhausted && controlMode === 'cloud' && !pvPriorityMode) {
        console.log(`[PV-Automation] ⚠️ Quota erschöpft (kein PV-Priority) - überspringe Raum-Verarbeitung komplett (${rooms.length} Räume)`);
        for (const room of rooms) {
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'skip',
            message: 'Quota erschöpft - keine API-Calls möglich',
            mlBased: false,
          });
        }
      } else

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

        // ============= ÜBERTEMPERATUR-SICHERHEITSREGEL =============
        // HARTER STOP: Wenn Ist-Temp >= Ziel + Deadband → sofort deaktivieren
        // Umgeht Cooldown! Verhindert minutenlanges Weiterheizen über Zieltemperatur
        const OVER_TEMP_DEADBAND = 0.4; // °C
        const currentRoomTempSafety = room.current_temp || 0;
        const currentTargetTempSafety = Number(room.target_temp) || 0;
        const isOverTemp = currentRoomTempSafety > 0 && currentTargetTempSafety > 0 && 
          currentRoomTempSafety >= currentTargetTempSafety + OVER_TEMP_DEADBAND;
        
        if (isOverTemp && room.is_heating) {
          console.log(`[PV-Automation] ${room.name}: ⚠️ ÜBER-TEMPERATUR! Ist=${currentRoomTempSafety}°C >= Ziel=${currentTargetTempSafety}°C + ${OVER_TEMP_DEADBAND}°C → FORCE STOP (Cooldown umgangen)`);
          // Direkt auf deactivate setzen, Rest der Logik überspringen
          // Temperatur nicht ändern, nur sicherstellen dass Heizung stoppt
          const safeTemp = currentTargetTempSafety; // Behalte aktuelle Zieltemperatur
          
          if (room.tuya_device_id) {
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, safeTemp);
            if (result.success) {
              await supabase.from('rooms').update({
                is_heating: false,
                pv_auto_active: false,
                pv_auto_last_change: now.toISOString(),
                last_auto_change: now.toISOString(),
                last_thermostat_sync: now.toISOString(),
                heating_paused_reason: 'over_temp',
              }).eq('id', room.id);
              if (controlMode === 'cloud' && result.success) {
                tuyaApiCalls++;
                // Dynamisch prüfen ob Quota jetzt erschöpft
                if (quotaData) {
                  const runningDaily = quotaData.calls_today + tuyaApiCalls;
                  const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                  const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                  if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                    quotaExhausted = true;
                    console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (over-temp stop)`);
                  }
                }
              }
            }
            results.push({
              roomId: room.id,
              roomName: room.name,
              action: 'deactivate',
              targetTemp: safeTemp,
              reasoning: `⚠️ Übertemperatur-Stop: ${currentRoomTempSafety.toFixed(1)}°C >= ${currentTargetTempSafety}°C + ${OVER_TEMP_DEADBAND}°C`,
              mlBased: false,
              success: result.success,
              overTempGuard: true,
            });
          }
          continue;
        }

        // Cooldown check - NUR für Aufheiz-Aktionen, NICHT für Sicherheits-Stops
        // Sicherheitsfälle (Übertemperatur oben bereits behandelt, Reduktionen werden unten geprüft)
        const inCooldown = minutesSinceChange < (settings?.min_switch_interval_min || DEFAULT_MIN_SWITCH_INTERVAL_MIN);
        // Cooldown wird erst NACH der Entscheidung angewendet (s.u.), nicht als blindes continue

        let action: 'activate' | 'deactivate' | 'keep' = 'keep';
        let targetTemp = room.target_temp || settings?.eco_temp || 19;
        let solarLimitTemp: number | null = null; // Solar-Limit: erlaubte Max-Temp bei Sonneneinstrahlung
        let reasoning = '';
        let expectedEnergyWh: number | undefined;
        let confidence: number | undefined;
        let mlDecision: MLDecision | null | undefined = null; // Außerhalb definiert für spätere Referenz

        // WICHTIG: Nachtzeit-Check ZUERST - hat IMMER Priorität über ML!
        const nightStart = settings?.night_start_time || '22:00';
        const nightEnd = settings?.night_end_time || '06:00';
        const { isNight, wienTime, wienHour } = isNightTime(nightStart, nightEnd);
        
        const ecoTemp = room.eco_temp || settings?.eco_temp || 19;
        const comfortTemp = room.comfort_temp || settings?.comfort_temp || 21;
        const nightTemp = room.night_temp || settings?.night_temp || 17;
        const currentTargetTemp = Number(room.target_temp) || 0;
        
        console.log(`[PV-Automation] ${room.name}: Wien-Zeit ${wienTime}, Nacht=${isNight} (${nightStart}-${nightEnd})`);

        // 1. NACHTMODUS - hat absolute Priorität über ALLES (auch ML!)
        if (isNight) {
          // currentTargetTemp ist jetzt oben definiert (Zeile ~922)
          
          const needsCorrection = Math.abs(currentTargetTemp - nightTemp) >= 0.5 || room.pv_auto_active;
          
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

          // ============= HARTER PV-GATE =============
          // KEINE Heizung ohne PV-Strom, unabhängig von ML/Learned Policies!
          // Dies ist die letzte Sicherheitsebene die NICHT übergangen werden kann.
          const noPvAvailable = pvPower < 500;
          const lowForecast = expectedPvKwh < 5; // Weniger als 5 kWh Tagesprognose
          const noPvHeatingAllowed = noPvAvailable && lowForecast;
          
          if (noPvHeatingAllowed) {
            console.log(`[PV-Automation] ${room.name}: ⛔ HARTER PV-GATE: Kein PV (${pvPower}W) + niedrige Prognose (${expectedPvKwh}kWh) → KEIN Heizen erlaubt`);
            // Wenn Raum aktiv heizt und über eco_temp ist → deaktivieren
            if (room.pv_auto_active || currentTargetTemp > ecoTemp + 0.5) {
              action = 'deactivate';
              targetTemp = ecoTemp;
              solarLimitTemp = null;
              reasoning = `⛔ Kein PV (${pvPower}W) + Prognose nur ${expectedPvKwh}kWh → Heizung gestoppt`;
            }
            // Sonst: keep, nichts ändern
          } else {
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
              
              // ============= PV-GATE FÜR ML-ACTIVATE =============
              // Auch gelernte Policies dürfen NUR bei tatsächlichem PV-Überschuss aktivieren
              if (action === 'activate' && pvPower < 500) {
                console.log(`[PV-Automation] ${room.name}: ⚠️ Learned Policy will activate, aber PV nur ${pvPower}W → BLOCKIERT`);
                action = 'keep';
                reasoning += ' → BLOCKIERT (kein PV)';
              }
            } else {
              // EXPLORATION: LLM-Entscheidung nutzen (zu wenig Daten oder schlechte Ergebnisse)
              mlDecision = useMLDecisions ? mlDecisions.find(d => d.room_id === room.id) : null;
              if (learnedPolicy) {
                console.log(`[PV-Automation] ${room.name}: Policy unzureichend (${learnedPolicy.sample_count} Samples, ${(learnedPolicy.success_rate*100).toFixed(0)}% Erfolg) → LLM-Exploration`);
              }
            }

            // (Solar-Gain-Erkennung und Morgen-Sperre entfernt — Thermostate regeln passiven Solargewinn selbst)

            // Only process ML/fallback if action is still 'keep' (not already set by morning wake-up or solar)
            if (action === 'keep') {
              if (mlDecision && usedMlDecision && useMLDecisions) {
                // Use ML/AI recommendation (nur tagsüber!)
                action = mlDecision.action;
                // ML-Temperatur auf comfort_temp deckeln — comfort ist das absolute Maximum
                targetTemp = Math.min(mlDecision.target_temp, comfortTemp);
                reasoning = mlDecision.reasoning + ' (KI)';
                expectedEnergyWh = mlDecision.expected_energy_wh;
                confidence = mlDecision.confidence;
                
                // ============= PV-GATE FÜR ML-ACTIVATE =============
                // ML darf NUR bei tatsächlichem PV-Überschuss aktivieren
                if (action === 'activate' && pvPower < 500) {
                  console.log(`[PV-Automation] ${room.name}: ⚠️ ML will activate, aber PV nur ${pvPower}W → BLOCKIERT`);
                  action = 'keep';
                  reasoning += ' → BLOCKIERT (kein PV)';
                }
              } else {
                // Basis-Zeitschaltung / Fallback (nur tagsüber)
                
                // 2. PV surplus/Solargewinn -> Solar-Modus aktivieren
                // ABER: Nur wenn tatsächlich genug PV-Leistung vorhanden!
                if (surplus >= thresholdOn && !room.pv_auto_active && pvPower >= 1000) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                  reasoning = `PV-Überschuss: ${ecoTemp}°C (${surplus}W Überschuss, ${pvPower}W PV)`;
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
                  targetTemp = ecoTemp;
                  solarLimitTemp = comfortTemp;
                }
                // 6. Daytime default: Eco-Temp nur setzen wenn PV verfügbar
                else if (!room.pv_auto_active && currentTargetTemp < ecoTemp && pvPower >= 500) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  solarLimitTemp = null;
                  reasoning = `Eco-Modus (PV verfügbar: ${pvPower}W): ${currentTargetTemp}°C → ${ecoTemp}°C`;
                }
                
                // ============= ÜBERSCHUSS-UMLEITUNG =============
                if (action === 'keep' && gridExport > 1000 && !room.pv_auto_active) {
                  const currentRoomTemp = room.current_temp || 0;
                  const roomNeedsHeating = currentRoomTemp < (ecoTemp - 0.5);
                  
                  if (roomNeedsHeating) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    solarLimitTemp = comfortTemp;
                    reasoning = `⚡ Überschuss-Nutzung: ${gridExport}W Export → Raum heizen statt einspeisen (${currentRoomTemp.toFixed(1)}°C < ${ecoTemp}°C)`;
                    console.log(`[PV-Automation] ${room.name}: ${reasoning}`);
                  }
                }
              }
            }
          }
        }

        // ============= LEISTUNGSBUDGET-OVERRIDE =============
        // Sequenzielles Heizen: Aktive Räume auf Comfort, Wartende auf Night-Temp
        // Das verhindert dass wartende Thermostate autonom heizen
        // Budget-Logik auch nachts bei leerem Akku aktiv (verhindert Netz-Heizen)
        if (powerBudgetEnabled && (budgetMode === 'pv_optimized' || budgetMode === 'grid_sequential')) {
          const budgetStatus = roomBudgetStatus.get(room.id);
          
          if (budgetStatus) {
            if (budgetStatus.shouldRotate) {
              // Rotation: Raum hat zu lange geheizt, pausieren für andere
              // Raum auf night_temp setzen statt 15°C - bleibt bewohnbar
              action = 'deactivate';
              targetTemp = nightTemp;
              solarLimitTemp = null;
              reasoning = `🔄 ${budgetStatus.reason} → ${nightTemp}°C (Rotation-Stopp)`;
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
              // Budget reicht nicht - auf night_temp setzen statt 15°C
              action = 'deactivate';
              targetTemp = nightTemp;
              solarLimitTemp = null;
              reasoning = `⏸️ ${budgetStatus.reason} → ${nightTemp}°C (Budget-Stopp)`;
              console.log(`[PV-Automation] ${room.name}: BUDGET-PAUSE - ${reasoning}`);
              
              // Tracking aktualisieren
              await supabase
                .from('rooms')
                .update({ heating_paused_reason: 'budget' })
                .eq('id', room.id);
            } else if (budgetStatus.allowedToHeat) {
              const currentRoomTemp = room.current_temp || 0;
              solarLimitTemp = null;
              
              if (budgetMode === 'grid_sequential') {
                // KEIN PV: Nur bis eco_temp heizen, dann stoppen
                if (currentRoomTemp < ecoTemp - 0.3) {
                  action = 'activate';
                  targetTemp = ecoTemp;
                  reasoning = `🔌 Grid-Heizen: ${ecoTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Budget: ${budgetStatus.reason})`;
                } else {
                  // Eco erreicht → nicht weiter heizen, auf eco_temp halten
                  action = 'keep';
                  targetTemp = ecoTemp;
                  reasoning = `✅ Eco erreicht (${currentRoomTemp.toFixed(1)}°C ≥ ${ecoTemp}°C) → kein Grid-Komfort-Heizen`;
                }
                console.log(`[PV-Automation] ${room.name}: GRID-HEIZEN - ${reasoning}`);
              } else {
                // ============= 2-PHASEN PV-HEIZLOGIK =============
                // targetLevel wurde in der Budget-Zuweisung bestimmt (eco oder comfort)
                // Keine Batterie-Bedingung! Budget = gridExport + heizende Räume + Toleranz
                const rp = roomsWithPriority.find(r => r.room.id === room.id);
                const roomHeatingPower = rp?.heatingPower || 800;
                const targetLevel = budgetStatus.targetLevel;
                console.log(`[PV-Automation] ${room.name}: 2-Phasen-Check → Level: ${targetLevel} (${budgetStatus.reason}, ${roomHeatingPower}W)`);
                
                if (targetLevel === 'comfort' || targetLevel === 'super_comfort') {
                  // Phase 2: Auf Komfort heizen
                  if (currentRoomTemp < comfortTemp - 0.3 || currentTargetTemp < comfortTemp) {
                    action = 'activate';
                    targetTemp = targetLevel === 'super_comfort' ? comfortTemp + 1 : comfortTemp;
                    reasoning = `☀️ Phase 2: Komfort ${targetTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Thermostat ${currentTargetTemp}°C, Budget OK: ${budgetStatus.reason})`;
                  } else {
                    action = 'keep';
                    targetTemp = comfortTemp;
                    reasoning = `✅ Komfort erreicht (${currentRoomTemp.toFixed(1)}°C ≥ ${comfortTemp}°C)`;
                  }
                } else if (targetLevel === 'eco') {
                  // Phase 1: Auf Eco heizen
                  const nightTempRoom = room.night_temp || settings?.night_temp || 17;
                  const ecoEqualsNight = ecoTemp <= nightTempRoom + 0.3;
                  
                  if (ecoEqualsNight && currentTargetTemp < comfortTemp) {
                    // eco == night → Eco setzen ist sinnlos, direkt auf Komfort
                    action = 'activate';
                    targetTemp = comfortTemp;
                    reasoning = `☀️ Eco=Nacht → direkt Komfort ${comfortTemp}°C (Thermostat ${currentTargetTemp}°C, Raum ${currentRoomTemp.toFixed(1)}°C)`;
                  } else if (currentRoomTemp < ecoTemp - 0.3 || currentTargetTemp < ecoTemp) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    reasoning = `☀️ Phase 1: Eco ${ecoTemp}°C (Raum ${currentRoomTemp.toFixed(1)}°C, Thermostat ${currentTargetTemp}°C, Budget OK: ${budgetStatus.reason})`;
                  } else {
                    // Eco erreicht, aber kein Budget für Komfort
                    action = 'keep';
                    targetTemp = ecoTemp;
                    reasoning = `✅ Eco erreicht (${currentRoomTemp.toFixed(1)}°C), kein Komfort-Budget`;
                  }
                } else {
                  // Fallback: Target-Korrektur wenn Thermostat zu niedrig
                  if (currentTargetTemp < ecoTemp - 1) {
                    action = 'activate';
                    targetTemp = ecoTemp;
                    reasoning = `🔧 Target-Korrektur: Thermostat bei ${currentTargetTemp}°C → ${ecoTemp}°C`;
                  } else {
                    action = 'keep';
                    targetTemp = currentRoomTemp >= ecoTemp ? ecoTemp : currentTargetTemp;
                    reasoning = `✅ Halten (${currentRoomTemp.toFixed(1)}°C)`;
                  }
                }
                console.log(`[PV-Automation] ${room.name}: PV-HEIZEN - ${reasoning}`);
              }
              
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

        // ============= TEMPERATUR-DECKELUNG =============
        // Super-Comfort (comfort+1) nur erlaubt wenn: Batterie voll, kein WW, alle Räume auf comfort, Export reicht
        const superComfortAllowed = allRoomsAtComfort && batterySoc >= 95 && !hotwaterActive;
        const maxAllowedTemp = superComfortAllowed ? comfortTemp + 1 : comfortTemp;
        
        if (targetTemp > maxAllowedTemp) {
          console.log(`[PV-Automation] ${room.name}: Zieltemp ${targetTemp}°C auf ${maxAllowedTemp}°C gedeckelt (SuperComfort=${superComfortAllowed})`);
          targetTemp = maxAllowedTemp;
        }

        // SYNC-FAILED GUARD: Wenn Pre-Sync fehlgeschlagen, nur Sicherheits-Aktionen erlauben
        if (syncFailed && action === 'activate') {
          console.log(`[PV-Automation] ${room.name}: SYNC-FAILED → activate blockiert, nur Reduktionen/Stops erlaubt`);
          action = 'keep';
          reasoning = 'Sync fehlgeschlagen, Aufheizen blockiert';
        }

        // ============= STALE-SYNC-CHECK: Force-Push wenn letzter Sync alt ist =============
        const lastSyncTime = room.last_thermostat_sync ? new Date(room.last_thermostat_sync).getTime() : 0;
        const syncAgeMs = Date.now() - lastSyncTime;
        const syncStale = syncAgeMs > 60 * 60 * 1000; // >60 Minuten (erhöht von 30 um Quota zu schonen)

        // Kritischer Sicherheitsfall: Bei wenig PV + altem Sync IMMER mindestens Eco/Nacht neu pushen
        // ABER: Nicht wenn Quota erschöpft — dann würde der API-Call sowieso blockiert
        const lowPvSafetyWindow = pvPower < 500 || expectedPvKwh < 5;
        if (action === 'keep' && syncStale && lowPvSafetyWindow && !quotaExhausted) {
          action = 'deactivate';
          targetTemp = Math.min(currentTargetTemp || ecoTemp, ecoTemp);
          solarLimitTemp = null;
          reasoning = `🔁 Sicherheits-Resync: wenig PV (${pvPower}W), Prognose ${expectedPvKwh}kWh`;
          console.log(`[PV-Automation] ${room.name}: FORCE-RESYNC bei Low-PV (last sync ${Math.round(syncAgeMs / 60000)} min)`);
        }

        // ============= COOLDOWN-GATE =============
        // Cooldown NUR für Aufheiz-Aktionen (activate, Temp erhöhen)
        // Sicherheits-Aktionen (deactivate, Temp senken) umgehen Cooldown IMMER
        const isSafetyAction = action === 'deactivate' || 
          (Number(targetTemp) < currentTargetTemp - 0.3);
        
        if (action !== 'keep' && inCooldown && !isSafetyAction) {
          console.log(`[PV-Automation] ${room.name}: COOLDOWN - ${Math.ceil((settings?.min_switch_interval_min || 5) - minutesSinceChange)} min (nur für Aufheiz-Aktionen)`);
          results.push({
            roomId: room.id,
            roomName: room.name,
            action: 'cooldown',
            message: `Wait ${Math.ceil((settings?.min_switch_interval_min || 5) - minutesSinceChange)} min (Aufheiz-Cooldown)`,
            mlBased: false
          });
          continue;
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
        // currentTargetTemp already defined above (line ~922)
        const newTargetTemp = Number(targetTemp) || 0;
        const tempAlreadyCorrect = Math.abs(currentTargetTemp - newTargetTemp) < 0.5; // 0.5°C tolerance
        const stateAlreadyCorrect = (action === 'activate' && room.pv_auto_active) || 
                                     (action === 'deactivate' && !room.pv_auto_active);
        
        // WICHTIG: Bei JEDER Temperatur-Reduktion API aufrufen (für sequenzielles Heizen)
        const needsToReduceTemp = newTargetTemp < currentTargetTemp - 0.5;
        
        // ÜBER-TEMPERATUR-STOP: Wenn is_heating=true aber Ist > Ziel → niemals skippen
        const needsHeatingStop = room.is_heating === true && 
          (room.current_temp || 0) > 0 && newTargetTemp > 0 &&
          (room.current_temp || 0) >= newTargetTemp + 0.3;
        
        const shouldSkip = tempAlreadyCorrect && stateAlreadyCorrect && !needsToReduceTemp && !syncStale && !needsHeatingStop;
        
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
        
        if (needsHeatingStop) {
          console.log(`[PV-Automation] ${room.name}: FORCE-STOP - is_heating=true but temp ${(room.current_temp || 0).toFixed(1)}°C >= target ${newTargetTemp}°C + 0.3°C`);
        }
        
        if (syncStale && tempAlreadyCorrect) {
          console.log(`[PV-Automation] ${room.name}: FORCE-SYNC - last sync ${Math.round(syncAgeMs / 60000)} min ago, pushing ${newTargetTemp}°C to device`);
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
        let tuyaError: { errorType?: string; errorMessage?: string } | null = null;

        if (action === 'activate') {
          if (room.tuya_device_id) {
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, targetTemp);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            if (controlMode === 'cloud' && result.success) {
              tuyaApiCalls++;
              if (quotaData) {
                const runningDaily = quotaData.calls_today + tuyaApiCalls;
                const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                  quotaExhausted = true;
                  console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (activate)`);
                }
              }
            }
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
              last_auto_change: now.toISOString(),
              last_thermostat_sync: now.toISOString(),
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
            const result = await setTemperatureForMode(room.tuya_device_id, room.id, finalTemp);
            success = result.success;
            if (!result.success) {
              tuyaError = { errorType: result.errorType, errorMessage: result.errorMessage };
            }
            if (controlMode === 'cloud' && result.success) {
              tuyaApiCalls++;
              if (quotaData) {
                const runningDaily = quotaData.calls_today + tuyaApiCalls;
                const runningMonthly = quotaData.calls_this_month + tuyaApiCalls;
                const effDL = Math.max(1, (quotaData.daily_limit || 33) - 2);
                if (runningDaily >= effDL || runningMonthly >= (quotaData.monthly_limit || 900)) {
                  quotaExhausted = true;
                  console.log(`[PV-Automation] ⚠️ Quota mid-run erschöpft nach ${tuyaApiCalls} Calls (deactivate)`);
                }
              }
            }
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
              last_auto_change: now.toISOString(),
              last_thermostat_sync: now.toISOString(),
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

      // ============= QUOTA PERSISTIEREN =============
      if (quotaData && tuyaApiCalls > 0) {
        // Jeder tuyaApiCall = 1 command API call (Token ist gecached)
        quotaData.calls_this_month += tuyaApiCalls;
        quotaData.calls_today += tuyaApiCalls;
      }
      if (quotaData) {
        await supabase.from('system_settings')
          .update({ value: quotaData, updated_at: new Date().toISOString() })
          .eq('key', 'tuya_api_quota');
      }

      const quotaInfo = quotaData 
        ? ` | Quota: ${quotaData.calls_today}/${quotaData.daily_limit} heute, ${quotaData.calls_this_month}/${quotaData.monthly_limit} monatlich`
        : '';
      const pvPriorityInfo = pvPriorityMode ? ` | ⚡ PV-Priority: ${pvPriorityCalls}/${PV_PRIORITY_MAX_CALLS} Calls` : '';
      console.log(`[PV-Automation] Complete. Tuya API calls: ${tuyaApiCalls}${quotaInfo}${pvPriorityInfo}${quotaExhausted && !pvPriorityMode ? ' ⚠️ QUOTA-FALLBACK aktiv' : ''}`);

      return new Response(JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        surplus,
        batterySoc,
        usedMlDecision,
        results,
        tuyaApiCalls,
        quotaExhausted,
        pvPriorityMode,
        pvPriorityCalls,
        quotaStatus: quotaData ? { today: quotaData.calls_today, dailyLimit: quotaData.daily_limit, month: quotaData.calls_this_month, monthlyLimit: quotaData.monthly_limit } : null,
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
