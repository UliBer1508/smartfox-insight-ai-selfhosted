import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// All Tuya Data Centers for multi-region support
const DATA_CENTERS = [
  { name: 'Central Europe', url: 'https://openapi.tuyaeu.com', region: 'eu' },
  { name: 'Western Europe', url: 'https://openapi-weaz.tuyaeu.com', region: 'we' },
  { name: 'Western America', url: 'https://openapi.tuyaus.com', region: 'us' },
  { name: 'Eastern America', url: 'https://openapi-ueaz.tuyaus.com', region: 'ue' },
  { name: 'India', url: 'https://openapi.tuyain.com', region: 'in' },
  { name: 'China', url: 'https://openapi.tuyacn.com', region: 'cn' },
];

// Default to Central Europe
let TUYA_API_BASE = 'https://openapi.tuyaeu.com';

interface TuyaToken {
  access_token: string;
  expire_time: number;
  refresh_token: string;
  uid: string;
}

let cachedToken: TuyaToken | null = null;
let tokenExpiry = 0;

// Helper to convert ArrayBuffer to hex string (uppercase)
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Create HMAC-SHA256 signature (returns uppercase hex)
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return bufferToHex(signature).toUpperCase();
}

// Calculate SHA256 hash of content (returns lowercase hex)
async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

// Build stringToSign for Tuya API
// stringToSign = HTTPMethod + "\n" + Content-SHA256 + "\n" + Headers + "\n" + URL
async function buildStringToSign(method: string, path: string, body: string = ''): Promise<string> {
  const contentHash = await sha256Hash(body);
  // No custom signature headers, so this is empty
  const headers = '';
  
  return `${method}\n${contentHash}\n${headers}\n${path}`;
}

// Get Tuya access token with configurable base URL
async function getAccessTokenWithUrl(baseUrl: string, accessId: string, accessSecret: string): Promise<{ token: string; raw: unknown }> {
  const timestamp = Date.now().toString();
  const nonce = '';
  const path = '/v1.0/token?grant_type=1';
  
  const stringToSign = await buildStringToSign('GET', path, '');
  const str = accessId + timestamp + nonce + stringToSign;
  const sign = await hmacSha256(accessSecret, str);

  console.log('Token request - url:', baseUrl, 'path:', path);

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'client_id': accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
    },
  });

  const data = await response.json();
  console.log('Token response:', JSON.stringify(data));

  if (!data.success) {
    throw new Error(`Failed to get token: ${data.msg} (code: ${data.code})`);
  }

  return { token: data.result.access_token, raw: data.result };
}

// Get Tuya access token using the current API base
async function getAccessToken(accessId: string, accessSecret: string): Promise<string> {
  const now = Date.now();
  
  if (cachedToken && tokenExpiry > now + 60000) {
    console.log('Using cached token');
    return cachedToken.access_token;
  }

  const { token, raw } = await getAccessTokenWithUrl(TUYA_API_BASE, accessId, accessSecret);
  cachedToken = raw as TuyaToken;
  tokenExpiry = now + ((raw as TuyaToken).expire_time * 1000);
  return token;
}

// Make authenticated Tuya API request
async function tuyaRequest(
  accessId: string,
  accessSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = await getAccessToken(accessId, accessSecret);
  const timestamp = Date.now().toString();
  const nonce = '';
  
  const bodyStr = body ? JSON.stringify(body) : '';
  
  // For general API: str = client_id + access_token + t + nonce + stringToSign
  const stringToSign = await buildStringToSign(method, path, bodyStr);
  const str = accessId + token + timestamp + nonce + stringToSign;
  const sign = await hmacSha256(accessSecret, str);

  console.log(`API request - ${method} ${path}`);
  console.log('API request - stringToSign:', JSON.stringify(stringToSign));

  const headers: Record<string, string> = {
    'client_id': accessId,
    'access_token': token,
    'sign': sign,
    'sign_method': 'HMAC-SHA256',
    't': timestamp,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${TUYA_API_BASE}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  const data = await response.json();
  console.log('Tuya API Response:', JSON.stringify(data));

  if (!data.success) {
    throw new Error(`Tuya API error: ${data.msg} (code: ${data.code})`);
  }

  return data.result;
}

// Get device status (single device)
async function getDeviceStatus(accessId: string, accessSecret: string, deviceId: string): Promise<unknown> {
  return await tuyaRequest(accessId, accessSecret, 'GET', `/v1.0/devices/${deviceId}/status`);
}

// Get batch device status (multiple devices in ONE API call - 90% quota savings!)
async function getBatchDeviceStatus(
  accessId: string, 
  accessSecret: string, 
  deviceIds: string[]
): Promise<Map<string, unknown[]>> {
  const result = new Map<string, unknown[]>();
  
  if (deviceIds.length === 0) return result;
  
  // Tuya batch endpoint: /v1.0/devices/status?device_ids=id1,id2,id3
  const idsParam = deviceIds.join(',');
  const path = `/v1.0/devices/status?device_ids=${idsParam}`;
  
  console.log(`[Tuya] Batch status request for ${deviceIds.length} devices`);
  
  const response = await tuyaRequest(accessId, accessSecret, 'GET', path);
  
  // Response can be either:
  // 1. Object with device_id as keys: { "deviceId1": [{code, value}...], "deviceId2": [...] }
  // 2. Array of { id: deviceId, status: [...] }
  if (response && typeof response === 'object') {
    if (Array.isArray(response)) {
      // Array format: [{ id: deviceId, status: [...] }]
      for (const device of response) {
        const d = device as { id: string; status: unknown[] };
        if (d.id && d.status) {
          result.set(d.id, d.status);
        }
      }
    } else {
      // Object format: { "deviceId1": [{code, value}...], "deviceId2": [...] }
      const responseObj = response as Record<string, unknown[]>;
      for (const [deviceId, statusArray] of Object.entries(responseObj)) {
        if (Array.isArray(statusArray)) {
          result.set(deviceId, statusArray);
        }
      }
    }
  }
  
  console.log(`[Tuya] Batch status received for ${result.size}/${deviceIds.length} devices`);
  return result;
}

// Set device temperature - TGP508 only supports temp_set via Cloud API
// NOTE: Mode command ('home') removed - causes Error 2008 on TGP508 thermostats
// Thermostats in "Programmiermodus" (auto) follow Cloud temp_set commands
async function setDeviceTemperature(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  temperature: number
): Promise<unknown> {
  // Temperature is in 0.1°C units for Tuya thermostats (e.g., 190 = 19.0°C)
  const tempValue = Math.round(temperature * 10);
  
  // Only send temp_set - mode command not supported by TGP508 Cloud API
  const commands = [{ code: 'temp_set', value: tempValue }];
  
  console.log(`[Tuya] Setting device ${deviceId} temp to ${temperature}°C (value: ${tempValue})`);
  
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands
  });
}

// Set device mode - NOTE: TGP508 only supports 'auto' via Cloud API
// 'home' mode must be set directly on the device
async function setDeviceMode(
  accessId: string,
  accessSecret: string,
  deviceId: string,
  mode: string
): Promise<unknown> {
  console.log(`[Tuya] Setting device ${deviceId} to mode: ${mode}`);
  return await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [
      { code: 'mode', value: mode }
    ]
  });
}

// Parse thermostat status from Tuya response (extended with mode)
// HYSTERESE: is_heating nur true wenn echte Wärmeanforderung besteht
// Verhindert "Heizt"-Anzeige wenn Ist-Temp bereits über Ziel liegt
function parseThermostatStatus(status: unknown[]): { currentTemp: number; targetTemp: number; isHeating: boolean; mode?: string } {
  let currentTemp = 0;
  let targetTemp = 0;
  let switchOn = false;
  let workStateHeating = false;
  let mode: string | undefined;

  if (Array.isArray(status)) {
    for (const item of status) {
      const s = item as { code: string; value: unknown };
      switch (s.code) {
        case 'temp_current':
          currentTemp = Number(s.value) / 10;
          break;
        case 'temp_set':
          targetTemp = Number(s.value) / 10;
          break;
        case 'switch':
          switchOn = s.value === true;
          break;
        case 'work_state':
          workStateHeating = s.value === 'heating';
          break;
        case 'mode':
          mode = String(s.value);
          break;
      }
    }
  }

  // Heizstatus mit Hysterese/Deadband bestimmen:
  // 1. Thermostat muss eingeschaltet sein (switch = true)
  // 2. Wenn Ist-Temp >= Ziel + 0.3°C → NICHT heizend (egal was work_state sagt)
  //    → Thermostat hat Ziel erreicht, work_state kann verzögert sein
  // 3. Wenn Ist-Temp < Ziel - 0.2°C → heizend (echte Wärmeanforderung)
  // 4. Im Deadband (Ziel-0.2 bis Ziel+0.3): work_state als Zusatzsignal verwenden
  const OVER_TEMP_DEADBAND = 0.3; // °C über Ziel → definitiv nicht heizend
  const UNDER_TEMP_TOLERANCE = 0.2; // °C unter Ziel → definitiv heizend
  
  let isHeating = false;
  if (switchOn) {
    if (currentTemp >= targetTemp + OVER_TEMP_DEADBAND) {
      // Übertemperatur: definitiv nicht heizend
      isHeating = false;
    } else if (currentTemp < targetTemp - UNDER_TEMP_TOLERANCE) {
      // Deutlich unter Ziel: heizend
      isHeating = true;
    } else {
      // Im Deadband: work_state als Signal nutzen
      isHeating = workStateHeating;
    }
  }

  return { currentTemp, targetTemp, isHeating, mode };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const knownKeys = [serviceRoleKey, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
    let isAuthorized = knownKeys.includes(token);

    if (!isAuthorized) {
      try {
        const payloadB64 = token.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
          const role = payload.role || payload.aud;
          isAuthorized = ['anon', 'authenticated', 'service_role'].includes(role);
          if (!isAuthorized) console.error(`[tuya-control] Auth rejected: role=${role}`);
        }
      } catch (e) {
        console.error(`[tuya-control] JWT decode failed: ${e}`);
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessId = Deno.env.get('TUYA_ACCESS_ID')?.trim();
    const accessSecret = Deno.env.get('TUYA_ACCESS_SECRET')?.trim();

    if (!accessId || !accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    console.log('Using accessId:', accessId, 'length:', accessId.length);

    const url = new URL(req.url);
    const path = url.pathname.replace('/tuya-control', '');

    console.log(`Request: ${req.method} ${path}`);

    // Initialize Supabase client with SERVICE_ROLE for DB operations
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load configured API URL from system_settings
    const { data: apiUrlSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'tuya_api_url')
      .maybeSingle();
    
    if (apiUrlSetting?.value?.url) {
      TUYA_API_BASE = apiUrlSetting.value.url;
      console.log('Using configured Tuya API URL:', TUYA_API_BASE);
    }

    // GET /devices - Not available with Basic Services, return empty
    if (req.method === 'GET' && path === '/devices') {
      console.log('Device list not available with Basic Services - use manual device ID entry');
      return new Response(JSON.stringify({ 
        success: true, 
        devices: [],
        message: 'Device list API not available. Please enter Device IDs manually from Tuya IoT Platform.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /status - Get status for device(s)
    if (req.method === 'POST' && path === '/status') {
      const { deviceId } = await req.json();
      
      if (deviceId) {
        const status = await getDeviceStatus(accessId, accessSecret, deviceId);
        const parsed = parseThermostatStatus(status as unknown[]);
        
        return new Response(JSON.stringify({ success: true, status: parsed }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get status for all configured rooms
      const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .not('tuya_device_id', 'is', null);

      const results = [];
      for (const room of rooms || []) {
        try {
          const status = await getDeviceStatus(accessId, accessSecret, room.tuya_device_id);
          const parsed = parseThermostatStatus(status as unknown[]);
          
          // Update room in database
          await supabase
            .from('rooms')
            .update({
              current_temp: parsed.currentTemp,
              target_temp: parsed.targetTemp,
              is_heating: parsed.isHeating,
              last_thermostat_sync: new Date().toISOString(),
            })
            .eq('id', room.id);

          results.push({ roomId: room.id, name: room.name, ...parsed });
        } catch (error) {
          console.error(`Error fetching status for room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, error: String(error) });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /set-temp - Set temperature for a device
    if (req.method === 'POST' && path === '/set-temp') {
      // MODE GUARD: Block Cloud API calls when in local mode
      const { data: modeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      const controlMode = (modeSetting?.value as { mode?: string })?.mode || 'cloud';

      if (controlMode === 'local') {
        console.log('[tuya-control] set-temp blocked: local mode active');
        return new Response(JSON.stringify({
          success: false,
          error: 'Cloud-Modus deaktiviert. Thermostate werden über den lokalen Service gesteuert.'
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // QUOTA GATE: Check before making any Tuya API call
      const { data: quotaSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_api_quota')
        .maybeSingle();
      
      let quotaBlocked = false;
      if (quotaSetting?.value) {
        const qd = quotaSetting.value as { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string };
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);
        if (qd.month !== currentMonth) { qd.calls_this_month = 0; qd.month = currentMonth; }
        if (qd.today !== wienDate) { qd.calls_today = 0; qd.today = wienDate; }
        const ml = qd.monthly_limit || 900;
        const dl = qd.daily_limit || 33;
        if (qd.calls_today > dl * 2) qd.calls_today = dl;
        if (qd.calls_this_month > ml * 2) qd.calls_this_month = ml;
        if (qd.calls_this_month >= ml || qd.calls_today >= Math.max(1, dl - 2)) {
          quotaBlocked = true;
        }
      }

      if (quotaBlocked) {
        console.log('[tuya-control] ⛔ set-temp blocked: Tuya API quota exhausted');
        return new Response(JSON.stringify({
          success: false,
          error: 'Tuya API Quota erschöpft - Thermostate können nicht ferngesteuert werden. Bitte manuell am Gerät oder über die Tuya App steuern.',
          quotaExhausted: true,
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { deviceId, temperature, roomId } = await req.json();
      
      if (!deviceId || temperature === undefined) {
        throw new Error('deviceId and temperature are required');
      }

      await setDeviceTemperature(accessId, accessSecret, deviceId, temperature);

      // Track quota: 1 API call for set-temp
      if (quotaSetting?.value) {
        const qd = quotaSetting.value as { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string; last_sync_at: string | null };
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);
        if (qd.month !== currentMonth) { qd.calls_this_month = 0; qd.month = currentMonth; }
        if (qd.today !== wienDate) { qd.calls_today = 0; qd.today = wienDate; }
        qd.calls_today++;
        qd.calls_this_month++;
        await supabase.from('system_settings')
          .update({ value: qd, updated_at: now.toISOString() })
          .eq('key', 'tuya_api_quota');
        console.log(`[tuya-control] Quota nach set-temp: ${qd.calls_today}/${qd.daily_limit} heute, ${qd.calls_this_month}/${qd.monthly_limit} monatlich`);
      }

      // Update room in database if roomId provided
      if (roomId) {
        await supabase
          .from('rooms')
          .update({
            target_temp: temperature,
            last_thermostat_sync: new Date().toISOString(),
          })
          .eq('id', roomId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /sync-all - Sync all thermostat statuses using BATCH API (90% quota savings!)
    if (req.method === 'POST' && path === '/sync-all') {
      // MODE CHECK: In local mode, just return DB data without Tuya API calls
      const { data: syncModeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      const syncControlMode = (syncModeSetting?.value as { mode?: string })?.mode || 'cloud';

      const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .not('tuya_device_id', 'is', null);

      if (!rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, results: [], message: 'No rooms configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (syncControlMode === 'local') {
        console.log('[tuya-control] sync-all: local mode - returning DB data only');
        const results = rooms.map(r => ({
          roomId: r.id,
          name: r.name,
          currentTemp: r.current_temp,
          targetTemp: r.target_temp,
          isHeating: r.is_heating,
          synced: false,
          localMode: true,
        }));
        return new Response(JSON.stringify({ success: true, results, localMode: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // QUOTA GATE for sync-all (counts as 2 API calls: token + batch status)
      const { data: syncQuotaSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_api_quota')
        .maybeSingle();
      
      let syncQuotaData = syncQuotaSetting?.value as { monthly_limit: number; calls_this_month: number; month: string; daily_limit: number; calls_today: number; today: string; last_sync_at: string | null } | null;
      if (syncQuotaData) {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const wienDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(now);
        if (syncQuotaData.month !== currentMonth) { syncQuotaData.calls_this_month = 0; syncQuotaData.month = currentMonth; }
        if (syncQuotaData.today !== wienDate) { syncQuotaData.calls_today = 0; syncQuotaData.today = wienDate; }
        if (syncQuotaData.calls_today > (syncQuotaData.daily_limit || 33) * 2) syncQuotaData.calls_today = syncQuotaData.daily_limit || 33;
        if (syncQuotaData.calls_this_month > (syncQuotaData.monthly_limit || 900) * 2) syncQuotaData.calls_this_month = syncQuotaData.monthly_limit || 900;
        
        const ml = syncQuotaData.monthly_limit || 900;
        const dl = syncQuotaData.daily_limit || 33;
        if (syncQuotaData.calls_this_month >= ml || syncQuotaData.calls_today >= Math.max(1, dl - 2)) {
          console.log(`[tuya-control] ⛔ sync-all blocked: quota exhausted (${syncQuotaData.calls_today}/${dl} today, ${syncQuotaData.calls_this_month}/${ml} monthly)`);
          // Return DB data instead
          const results = rooms.map(r => ({
            roomId: r.id, name: r.name,
            currentTemp: r.current_temp, targetTemp: r.target_temp,
            isHeating: r.is_heating, synced: false, quotaExhausted: true,
          }));
          return new Response(JSON.stringify({ success: true, results, quotaExhausted: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Get current total consumption and PV power for analysis
      const { data: latestReading } = await supabase
        .from('energy_readings')
        .select('consumption, pv_power')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();
      
      const currentConsumption = latestReading?.consumption || 0;
      const currentPvPower = latestReading?.pv_power || 0;

      // BATCH API: Get all device statuses in ONE API call instead of 10 separate calls!
      const deviceIds = rooms.map(r => r.tuya_device_id).filter(Boolean) as string[];
      let batchStatus: Map<string, unknown[]>;
      
      try {
        batchStatus = await getBatchDeviceStatus(accessId, accessSecret, deviceIds);
        console.log(`[sync-all] Batch API: 1 call for ${deviceIds.length} devices (saved ${deviceIds.length - 1} API calls)`);
      } catch (batchError) {
        console.error('[sync-all] Batch API failed:', batchError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: String(batchError),
          message: 'Batch API failed - check Tuya quota'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results = [];
      for (const room of rooms) {
        try {
          // Use cached batch result instead of individual API call
          const status = batchStatus.get(room.tuya_device_id);
          if (!status) {
            console.warn(`[${room.name}] No status in batch response for device ${room.tuya_device_id}`);
            results.push({ roomId: room.id, name: room.name, error: 'No status in batch response', synced: false });
            continue;
          }
          const parsed = parseThermostatStatus(status as unknown[]);
          
          const previousIsHeating = room.is_heating;
          const now = new Date().toISOString();

          // ALWAYS save temperature sample for solar gain analysis
          await supabase.from('room_temperature_samples').insert({
            room_id: room.id,
            timestamp: now,
            temperature: parsed.currentTemp,
            is_heating: parsed.isHeating,
            pv_power_w: Math.round(currentPvPower),
          });

          // Log heating state changes
          if (previousIsHeating !== parsed.isHeating) {
            if (parsed.isHeating) {
              // Heating just started - save current consumption for power calculation
              console.log(`[${room.name}] Heating started, consumption: ${currentConsumption}W`);
              await supabase.from('room_heating_logs').insert({
                room_id: room.id,
                event_type: 'heating_start',
                current_temp: parsed.currentTemp,
                target_temp: parsed.targetTemp,
                timestamp: now,
                consumption_at_start_w: Math.round(currentConsumption),
              });
            } else {
              // Heating just stopped - calculate duration and power from consumption difference
              console.log(`[${room.name}] Heating stopped, consumption: ${currentConsumption}W`);
              
              const { data: lastStart, error: lastStartError } = await supabase
                .from('room_heating_logs')
                .select('*')
                .eq('room_id', room.id)
                .eq('event_type', 'heating_start')
                .order('timestamp', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (lastStartError) {
                console.error(`[${room.name}] Error finding heating_start:`, lastStartError);
              }

              let durationMinutes = 2; // Fallback: Minimum 2 Minuten (Sync-Intervall)
              let energyEstimateWh = 0;
              let consumptionDuringAvg = null;
              let deleteStartRecord = false;

              if (lastStart?.timestamp) {
                const startTime = new Date(lastStart.timestamp).getTime();
                const endTime = new Date(now).getTime();
                const calculatedDuration = Math.round((endTime - startTime) / 60000);
                
                // Plausibilitätsprüfung: Max 4 Stunden (240 Min) pro Heizzyklus
                if (calculatedDuration > 0 && calculatedDuration <= 240) {
                  durationMinutes = calculatedDuration;
                  deleteStartRecord = true; // Markiere zum Löschen um Doppelverwendung zu verhindern
                  
                  // Calculate average consumption during heating for power estimation
                  if (lastStart.consumption_at_start_w !== null) {
                    consumptionDuringAvg = currentConsumption;
                  }
                  
                  // Use calculated or estimated power for energy calculation
                  const effectivePower = room.calculated_power_w || room.heating_power_w || 0;
                  if (effectivePower) {
                    energyEstimateWh = Math.round((effectivePower * durationMinutes) / 60);
                  }
                } else {
                  console.warn(`[${room.name}] Implausible duration ${calculatedDuration}min (>4h), using fallback`);
                  durationMinutes = 2;
                  deleteStartRecord = true; // Lösche trotzdem den veralteten Start-Eintrag
                }
              }

              await supabase.from('room_heating_logs').insert({
                room_id: room.id,
                event_type: 'heating_stop',
                current_temp: parsed.currentTemp,
                target_temp: parsed.targetTemp,
                duration_minutes: durationMinutes,
                energy_estimate_wh: energyEstimateWh,
                timestamp: now,
                consumption_at_start_w: lastStart?.consumption_at_start_w || null,
                consumption_during_avg_w: consumptionDuringAvg ? Math.round(consumptionDuringAvg) : null,
              });

              // Lösche den verwendeten heating_start um Doppelverwendung zu verhindern
              if (deleteStartRecord && lastStart?.id) {
                await supabase
                  .from('room_heating_logs')
                  .delete()
                  .eq('id', lastStart.id);
              }

              // Update room stats
              await supabase
                .from('rooms')
                .update({
                  last_heating_duration_min: durationMinutes,
                })
                .eq('id', room.id);
            }
          } else if (parsed.isHeating) {
            // Room is heating but status didn't change - check if we have an open heating_start
            const { data: lastLog } = await supabase
              .from('room_heating_logs')
              .select('*')
              .eq('room_id', room.id)
              .order('timestamp', { ascending: false })
              .limit(1)
              .single();

            // If no logs exist or the last log is a stop, create a new start
            if (!lastLog || lastLog.event_type === 'heating_stop') {
              console.log(`[${room.name}] Creating missing heating_start entry`);
              await supabase.from('room_heating_logs').insert({
                room_id: room.id,
                event_type: 'heating_start',
                current_temp: parsed.currentTemp,
                target_temp: parsed.targetTemp,
                timestamp: now,
                consumption_at_start_w: Math.round(currentConsumption),
              });
            }
          }

          await supabase
            .from('rooms')
            .update({
              current_temp: parsed.currentTemp,
              target_temp: parsed.targetTemp,
              is_heating: parsed.isHeating,
              last_thermostat_sync: now,
            })
            .eq('id', room.id);

          results.push({ roomId: room.id, name: room.name, ...parsed, synced: true });
        } catch (error) {
          console.error(`Error syncing room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, error: String(error), synced: false });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /test - Connection test with detailed diagnostics and multi-region support
    if (req.method === 'POST' && path === '/test') {
      interface RegionResult {
        name: string;
        url: string;
        region: string;
        success: boolean;
        error?: string;
        error_code?: string;
        quota_exhausted?: boolean;
      }

      const testResult = {
        credentials_configured: !!accessId && !!accessSecret,
        token_valid: false,
        token_error: null as string | null,
        api_accessible: false,
        api_error: null as string | null,
        quota_exhausted: false,
        error_code: null as string | null,
        error_message: null as string | null,
        devices_count: 0,
        tested_at: new Date().toISOString(),
        current_region: TUYA_API_BASE,
        region_results: [] as RegionResult[],
        working_regions: [] as string[],
      };

      // Step 1: Check credentials
      if (!testResult.credentials_configured) {
        return new Response(JSON.stringify({ success: true, ...testResult }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Step 2: Test all regions in parallel
      console.log('Testing all Tuya data centers...');
      const regionPromises = DATA_CENTERS.map(async (dc) => {
        try {
          await getAccessTokenWithUrl(dc.url, accessId, accessSecret);
          return { 
            name: dc.name, 
            url: dc.url, 
            region: dc.region, 
            success: true 
          };
        } catch (error) {
          const errorStr = String(error);
          const codeMatch = errorStr.match(/code:\s*(\d+)/);
          return { 
            name: dc.name, 
            url: dc.url, 
            region: dc.region, 
            success: false, 
            error: errorStr.substring(0, 100),
            error_code: codeMatch?.[1] || undefined,
            quota_exhausted: codeMatch?.[1] === '28841004',
          };
        }
      });

      testResult.region_results = await Promise.all(regionPromises);
      testResult.working_regions = testResult.region_results
        .filter(r => r.success)
        .map(r => r.name);

      // Step 3: Test current region token
      try {
        cachedToken = null;
        tokenExpiry = 0;
        await getAccessToken(accessId, accessSecret);
        testResult.token_valid = true;
      } catch (error) {
        const errorStr = String(error);
        testResult.token_error = errorStr;
        
        const codeMatch = errorStr.match(/code:\s*(\d+)/);
        if (codeMatch) {
          testResult.error_code = codeMatch[1];
          if (codeMatch[1] === '28841004') {
            testResult.quota_exhausted = true;
            testResult.error_message = 'Trial Edition quota exhausted';
          }
        }
        
        // Return early but include region results
        return new Response(JSON.stringify({ success: true, ...testResult }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Step 4: Test device API access
      const { data: rooms } = await supabase
        .from('rooms')
        .select('tuya_device_id, name')
        .not('tuya_device_id', 'is', null);

      testResult.devices_count = rooms?.length || 0;

      if (rooms && rooms.length > 0) {
        try {
          await getDeviceStatus(accessId, accessSecret, rooms[0].tuya_device_id);
          testResult.api_accessible = true;
        } catch (error) {
          const errorStr = String(error);
          testResult.api_error = errorStr;
          
          const codeMatch = errorStr.match(/code:\s*(\d+)/);
          if (codeMatch) {
            testResult.error_code = codeMatch[1];
            if (codeMatch[1] === '28841004') {
              testResult.quota_exhausted = true;
              testResult.error_message = 'Trial Edition quota exhausted';
            } else if (codeMatch[1] === '1004') {
              testResult.error_message = 'Invalid signature - check credentials';
            } else if (codeMatch[1] === '2017') {
              testResult.error_message = 'Device offline';
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true, ...testResult }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /set-region - Set the Tuya API region
    if (req.method === 'POST' && path === '/set-region') {
      const { url, region } = await req.json();
      
      if (!url) {
        throw new Error('url is required');
      }

      // Validate URL is a known data center
      const validDc = DATA_CENTERS.find(dc => dc.url === url);
      if (!validDc) {
        throw new Error('Invalid data center URL');
      }

      // Save to system_settings
      await supabase
        .from('system_settings')
        .upsert({
          key: 'tuya_api_url',
          value: { url, region: region || validDc.region, name: validDc.name },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      // Clear token cache to use new region
      cachedToken = null;
      tokenExpiry = 0;

      return new Response(JSON.stringify({ success: true, url, region: validDc.name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /device-spec - Get device specifications to understand available values
    if (req.method === 'POST' && path === '/device-spec') {
      const { deviceId } = await req.json();
      
      if (!deviceId) {
        throw new Error('deviceId is required');
      }

      // Get device specifications from Tuya
      const spec = await tuyaRequest(accessId, accessSecret, 'GET', `/v1.0/devices/${deviceId}/specifications`);
      
      return new Response(JSON.stringify({ success: true, spec }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /set-mode-all - Set thermostats to Cloud-controllable mode
    // NOTE: For TGP508: 'home' = non-programmable (manual), 'auto' = programmable
    // When in 'home' mode, thermostats obey Cloud temp_set commands directly!
    if (req.method === 'POST' && path === '/set-mode-all') {
      const { mode } = await req.json().catch(() => ({}));
      const targetMode = mode || 'home'; // Default to 'home' (non-programmable, direct control)
      
      const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .not('tuya_device_id', 'is', null);

      if (!rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, results: [], message: 'No rooms configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[set-mode-all] Setting ${rooms.length} thermostats to mode: ${targetMode}`);

      const results = [];
      for (const room of rooms) {
        try {
          await setDeviceMode(accessId, accessSecret, room.tuya_device_id, targetMode);
          results.push({ roomId: room.id, name: room.name, success: true, mode: targetMode });
          console.log(`[${room.name}] Mode set to ${targetMode}`);
        } catch (error) {
          console.error(`Error setting mode for room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, success: false, error: String(error) });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[set-mode-all] Complete: ${successCount}/${rooms.length} successful`);

      return new Response(JSON.stringify({ success: true, results, summary: `${successCount}/${rooms.length} set to ${targetMode}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /push-all-temps - Push target_temp from DB to all thermostats via Tuya Cloud
    if (req.method === 'POST' && path === '/push-all-temps') {
      // MODE GUARD: Block Cloud API calls when in local mode
      const { data: pushModeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_control_mode')
        .maybeSingle();
      const pushControlMode = (pushModeSetting?.value as { mode?: string })?.mode || 'cloud';

      if (pushControlMode === 'local') {
        return new Response(JSON.stringify({
          success: false,
          error: 'Cloud-Modus deaktiviert. Thermostate werden über den lokalen Service gesteuert.'
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name, tuya_device_id, target_temp')
        .not('tuya_device_id', 'is', null)
        .not('target_temp', 'is', null);

      if (!rooms || rooms.length === 0) {
        return new Response(JSON.stringify({ success: true, results: [], message: 'No rooms with Tuya devices configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[push-all-temps] Pushing target temps to ${rooms.length} thermostats...`);

      const results = [];
      const now = new Date().toISOString();

      for (const room of rooms) {
        try {
          await setDeviceTemperature(accessId, accessSecret, room.tuya_device_id, room.target_temp);

          // Update last_thermostat_sync in DB
          await supabase
            .from('rooms')
            .update({ last_thermostat_sync: now })
            .eq('id', room.id);

          results.push({ roomId: room.id, name: room.name, targetTemp: room.target_temp, success: true });
          console.log(`[${room.name}] ✓ Pushed ${room.target_temp}°C`);
        } catch (error) {
          console.error(`[push-all-temps] Error for room ${room.name}:`, error);
          results.push({ roomId: room.id, name: room.name, targetTemp: room.target_temp, success: false, error: String(error) });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[push-all-temps] Complete: ${successCount}/${rooms.length} successful`);

      return new Response(JSON.stringify({
        success: true,
        results,
        summary: `${successCount}/${rooms.length}`,
        successCount,
        totalCount: rooms.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /switch - Turn thermostat on/off (switch DPS)
    if (req.method === 'POST' && path === '/switch') {
      const { deviceId, switchOn, roomId } = await req.json();
      
      if (!deviceId || switchOn === undefined) {
        throw new Error('deviceId and switchOn are required');
      }

      console.log(`[Tuya] Setting device ${deviceId} switch to ${switchOn}`);
      
      await tuyaRequest(accessId, accessSecret, 'POST', `/v1.0/devices/${deviceId}/commands`, {
        commands: [{ code: 'switch', value: Boolean(switchOn) }]
      });

      // Update room in database if roomId provided
      if (roomId) {
        await supabase
          .from('rooms')
          .update({
            is_heating: false,
            last_thermostat_sync: new Date().toISOString(),
            heating_paused_reason: switchOn ? null : 'night_off',
          })
          .eq('id', roomId);
      }

      return new Response(JSON.stringify({ success: true, switchOn }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
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
